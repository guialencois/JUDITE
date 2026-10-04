"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { comTracos, META_GRAPH_URL, META_VERSAO, soDigitos } from "@/lib/conexoes/config";
import { gravarConexao } from "@/lib/conexoes/segredos";
import { createAdminClient } from "@/lib/supabase/admin";

const wsSchema = z.uuid();
const pagina = (ws: string, sufixo: string) => `/painel/${ws}/conexoes?${sufixo}`;
type Admin = ReturnType<typeof createAdminClient>;

/** Liga a conta de anúncios ao workspace, sem deixar um workspace "tomar" a conta de outro. */
async function registrarConta(db: Admin, workspaceId: string, plataforma: "google_ads" | "facebook", conta: string, nome: string | null) {
  await db.from("trafego_contas").upsert(
    { workspace_id: workspaceId, plataforma, conta_externa: conta, nome, ativo: true },
    { onConflict: "plataforma,conta_externa", ignoreDuplicates: true },
  );
  const { data } = await db
    .from("trafego_contas")
    .select("workspace_id")
    .eq("plataforma", plataforma)
    .eq("conta_externa", conta)
    .maybeSingle();
  return data?.workspace_id === workspaceId;
}

const googleSchema = z.object({
  workspaceId: wsSchema,
  cliente: z.string().transform(soDigitos).pipe(z.string().length(10)),
  gerente: z.string().transform(soDigitos).pipe(z.union([z.literal(""), z.string().length(10)])),
});

export async function salvarGoogle(formData: FormData) {
  const parsed = googleSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    cliente: formData.get("cliente") ?? "",
    gerente: formData.get("gerente") ?? "",
  });
  const ws = String(formData.get("workspaceId"));
  if (!parsed.success) redirect(pagina(ws, "erro=google-id"));
  const dono = await exigirDono(parsed.data.workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const db = createAdminClient();
  const conta = comTracos(parsed.data.cliente);
  if (!(await registrarConta(db, parsed.data.workspaceId, "google_ads", conta, null))) {
    redirect(pagina(ws, "erro=conta-de-outro"));
  }

  const { error } = await gravarConexao(db, parsed.data.workspaceId, "google_ads", dono.userId, {
    dados: { cliente: conta, gerente: parsed.data.gerente ? comTracos(parsed.data.gerente) : null },
  });
  if (error) redirect(pagina(ws, "erro=salvar"));
  revalidatePath(`/painel/${ws}/conexoes`);
  redirect(pagina(ws, "aviso=google-conta"));
}

const opcional = (re: RegExp) =>
  z.string().trim().transform((v) => v || undefined).pipe(z.string().regex(re).optional());

const googleAppSchema = z.object({
  workspaceId: wsSchema,
  developerToken: opcional(/^[A-Za-z0-9_-]{10,100}$/),
  clientId: opcional(/^[A-Za-z0-9._-]{10,200}\.apps\.googleusercontent\.com$/),
  clientSecret: opcional(/^[A-Za-z0-9_-]{10,200}$/),
});

/** Credenciais do Google (developer token e app OAuth). Campo vazio mantém o valor já salvo. */
export async function salvarGoogleApp(formData: FormData) {
  const parsed = googleAppSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    developerToken: formData.get("developerToken") ?? "",
    clientId: formData.get("clientId") ?? "",
    clientSecret: formData.get("clientSecret") ?? "",
  });
  const ws = String(formData.get("workspaceId"));
  if (!parsed.success) redirect(pagina(ws, "erro=google-app-dados"));
  const dono = await exigirDono(parsed.data.workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const { error } = await gravarConexao(createAdminClient(), parsed.data.workspaceId, "google_ads", dono.userId, {
    segredos: {
      developer_token: parsed.data.developerToken,
      client_id: parsed.data.clientId,
      client_secret: parsed.data.clientSecret,
    },
  });
  if (error) redirect(pagina(ws, "erro=salvar"));
  revalidatePath(`/painel/${ws}/conexoes`);
  redirect(pagina(ws, "aviso=google-app"));
}

const metaSchema = z.object({
  workspaceId: wsSchema,
  conta: z.string().transform(soDigitos).pipe(z.string().min(5).max(20)),
  token: z.string().trim().regex(/^[A-Za-z0-9_-]{20,1000}$/),
});

export async function salvarMeta(formData: FormData) {
  const parsed = metaSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    conta: formData.get("conta") ?? "",
    token: formData.get("token") ?? "",
  });
  const ws = String(formData.get("workspaceId"));
  if (!parsed.success) redirect(pagina(ws, "erro=meta-dados"));
  const dono = await exigirDono(parsed.data.workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  // Testa o token na própria Meta antes de guardar (o token vai no cabeçalho, nunca na URL).
  const conta = `act_${parsed.data.conta}`;
  const teste = await fetch(`${META_GRAPH_URL}/${META_VERSAO}/${conta}?fields=name,currency,account_status`, {
    headers: { Authorization: `Bearer ${parsed.data.token}` },
    cache: "no-store",
  }).catch(() => null);
  const info = (await teste?.json().catch(() => null)) as { name?: string; currency?: string } | null;
  if (!teste?.ok || !info?.name) redirect(pagina(ws, "erro=meta-validacao"));

  const db = createAdminClient();
  if (!(await registrarConta(db, parsed.data.workspaceId, "facebook", conta, info.name ?? null))) {
    redirect(pagina(ws, "erro=conta-de-outro"));
  }
  const { error } = await gravarConexao(db, parsed.data.workspaceId, "meta", dono.userId, {
    dados: { conta, nome: info.name, moeda: info.currency ?? null, validado_em: new Date().toISOString() },
    segredos: { token: parsed.data.token },
  });
  if (error) redirect(pagina(ws, "erro=salvar"));
  revalidatePath(`/painel/${ws}/conexoes`);
  redirect(pagina(ws, "aviso=meta-conectada"));
}

export async function desconectar(formData: FormData) {
  const parsed = z.object({ workspaceId: wsSchema, provedor: z.enum(["google_ads", "meta"]) }).safeParse({
    workspaceId: formData.get("workspaceId"),
    provedor: formData.get("provedor"),
  });
  if (!parsed.success) redirect("/painel");
  if (!(await exigirDono(parsed.data.workspaceId))) redirect(pagina(parsed.data.workspaceId, "erro=so-dono"));

  // Apaga a conexão inteira, inclusive o token criptografado.
  await createAdminClient().from("conexoes").delete()
    .eq("workspace_id", parsed.data.workspaceId).eq("provedor", parsed.data.provedor);
  revalidatePath(`/painel/${parsed.data.workspaceId}/conexoes`);
  redirect(pagina(parsed.data.workspaceId, "aviso=desconectado"));
}
