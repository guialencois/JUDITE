"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { appMeta, mccPadraoGoogle } from "@/lib/conexoes/app";
import { escolherEntre, revogarNaPlataforma } from "@/lib/conexoes/plataformas";
import { comTracos, META_GRAPH_URL, META_VERSAO, soDigitos, TIKTOK_API_URL } from "@/lib/conexoes/config";
import { gravarConexao, lerConexao } from "@/lib/conexoes/segredos";
import { createAdminClient } from "@/lib/supabase/admin";

const wsSchema = z.uuid();
const pagina = (ws: string, sufixo: string) => `/painel/${ws}/conexoes?${sufixo}`;
type Admin = ReturnType<typeof createAdminClient>;

/** Liga a conta de anúncios ao workspace, sem deixar um workspace "tomar" a conta de outro. */
async function registrarConta(db: Admin, workspaceId: string, plataforma: "google_ads" | "facebook" | "tiktok", conta: string, nome: string | null) {
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
    // Token colado à mão (usuário do sistema): não vence e não usa o app da JUDITE.
    dados: {
      conta, nome: info.name, moeda: info.currency ?? null, validado_em: new Date().toISOString(),
      modo: "usuario_sistema", app_origem: "workspace", expira_em: null, precisa_reconectar: false, motivo_reconexao: null, contas_disponiveis: [],
    },
    segredos: { token: parsed.data.token },
  });
  if (error) redirect(pagina(ws, "erro=salvar"));
  revalidatePath(`/painel/${ws}/conexoes`);
  redirect(pagina(ws, "aviso=meta-conectada"));
}

const tiktokAppSchema = z.object({
  workspaceId: wsSchema,
  appId: opcional(/^[0-9]{10,30}$/),
  secret: opcional(/^[A-Za-z0-9]{20,100}$/),
});

/** Credenciais do app do TikTok for Business. Campo vazio mantém o valor já salvo. */
export async function salvarTikTokApp(formData: FormData) {
  const parsed = tiktokAppSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    appId: formData.get("appId") ?? "",
    secret: formData.get("secret") ?? "",
  });
  const ws = String(formData.get("workspaceId"));
  if (!parsed.success) redirect(pagina(ws, "erro=tiktok-app-dados"));
  const dono = await exigirDono(parsed.data.workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const { error } = await gravarConexao(createAdminClient(), parsed.data.workspaceId, "tiktok", dono.userId, {
    segredos: { app_id: parsed.data.appId, secret: parsed.data.secret },
  });
  if (error) redirect(pagina(ws, "erro=salvar-tiktok"));
  revalidatePath(`/painel/${ws}/conexoes`);
  redirect(pagina(ws, "aviso=tiktok-app"));
}

const tiktokContaSchema = z.object({ workspaceId: wsSchema, conta: z.string().trim().regex(/^[0-9]{5,25}$/) });

/** Escolhe qual conta de anúncios (advertiser) do TikTok este workspace usa, entre as autorizadas. */
export async function salvarTikTok(formData: FormData) {
  const parsed = tiktokContaSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    conta: formData.get("conta") ?? "",
  });
  const ws = String(formData.get("workspaceId"));
  if (!parsed.success) redirect(pagina(ws, "erro=tiktok-dados"));
  const dono = await exigirDono(parsed.data.workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const db = createAdminClient();
  const { segredos, dados } = await lerConexao(db, parsed.data.workspaceId, "tiktok");
  if (!segredos.access_token) redirect(pagina(ws, "erro=tiktok-autorizar"));
  const autorizadas = Array.isArray(dados.anunciantes) ? dados.anunciantes.map(String) : [];
  if (autorizadas.length && !autorizadas.includes(parsed.data.conta)) redirect(pagina(ws, "erro=tiktok-conta"));

  // Confere a conta no próprio TikTok antes de guardar (o token vai no cabeçalho, nunca na URL).
  const busca = new URLSearchParams({ advertiser_ids: JSON.stringify([parsed.data.conta]) });
  const teste = await fetch(`${TIKTOK_API_URL}/advertiser/info/?${busca.toString()}`, {
    headers: { "Access-Token": segredos.access_token },
    cache: "no-store",
  }).catch(() => null);
  const info = (await teste?.json().catch(() => null)) as {
    code?: number; data?: { list?: { name?: string; currency?: string }[] };
  } | null;
  const anunciante = info?.code === 0 ? info.data?.list?.[0] : undefined;
  if (!anunciante?.name) redirect(pagina(ws, "erro=tiktok-conta"));

  if (!(await registrarConta(db, parsed.data.workspaceId, "tiktok", parsed.data.conta, anunciante.name))) {
    redirect(pagina(ws, "erro=conta-de-outro"));
  }
  const { error } = await gravarConexao(db, parsed.data.workspaceId, "tiktok", dono.userId, {
    dados: { conta: parsed.data.conta, nome: anunciante.name, moeda: anunciante.currency ?? null, validado_em: new Date().toISOString() },
  });
  if (error) redirect(pagina(ws, "erro=salvar-tiktok"));
  revalidatePath(`/painel/${ws}/conexoes`);
  redirect(pagina(ws, "aviso=tiktok-conectado"));
}

const escolhaSchema = z.object({
  workspaceId: wsSchema,
  provedor: z.enum(["google_ads", "meta"]),
  conta: z.string().trim().min(3).max(40),
});

/**
 * Escolhe a conta de anúncios entre as que a plataforma devolveu no login ("Conectar com Google / Facebook").
 * Só o dono. A conta precisa estar na lista guardada: não dá para apontar para uma conta que o login não alcança.
 */
export async function escolherConta(formData: FormData) {
  const parsed = escolhaSchema.safeParse({
    workspaceId: formData.get("workspaceId"), provedor: formData.get("provedor"), conta: formData.get("conta") ?? "",
  });
  const ws = String(formData.get("workspaceId"));
  if (!parsed.success) redirect(wsSchema.safeParse(ws).success ? pagina(ws, "erro=conta-escolha") : "/painel");
  const { workspaceId, provedor } = parsed.data;
  const dono = await exigirDono(workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const db = createAdminClient();
  const { dados } = await lerConexao(db, workspaceId, provedor);
  const conta = escolherEntre(dados.contas_disponiveis, parsed.data.conta);
  if (!conta) redirect(pagina(ws, "erro=conta-escolha"));

  if (!(await registrarConta(db, workspaceId, provedor === "meta" ? "facebook" : "google_ads", conta.id, conta.nome))) {
    redirect(pagina(ws, "erro=conta-de-outro"));
  }
  const mcc = mccPadraoGoogle();
  const { error } = await gravarConexao(db, workspaceId, provedor, dono.userId, {
    dados: provedor === "meta"
      ? { conta: conta.id, nome: conta.nome, moeda: conta.moeda ?? null, validado_em: new Date().toISOString() }
      // login_customer_id: a conta de administrador pela qual a conta é acessada; sem ela, a MCC padrão da plataforma.
      : { cliente: conta.id, nome: conta.nome, moeda: conta.moeda ?? null, gerente: conta.gerente ?? (mcc ? comTracos(mcc) : null) },
  });
  if (error) redirect(pagina(ws, "erro=salvar"));
  revalidatePath(`/painel/${ws}/conexoes`);
  redirect(pagina(ws, provedor === "meta" ? "aviso=meta-conectada" : "aviso=google-conta"));
}

/** Desconectar: revoga o acesso na própria plataforma (quando dá) e apaga os tokens criptografados. Só o dono. */
export async function desconectar(formData: FormData) {
  const parsed = z.object({ workspaceId: wsSchema, provedor: z.enum(["google_ads", "meta", "tiktok", "google_presenca"]) }).safeParse({
    workspaceId: formData.get("workspaceId"),
    provedor: formData.get("provedor"),
  });
  if (!parsed.success) redirect("/painel");
  const { workspaceId, provedor } = parsed.data;
  if (!(await exigirDono(workspaceId))) redirect(pagina(workspaceId, "erro=so-dono"));

  const db = createAdminClient();
  // Se o segredo não abrir (chave trocada), a conexão é apagada do mesmo jeito, só sem revogar na plataforma.
  const conexao = await lerConexao(db, workspaceId, provedor).catch(() => null);
  const outroGoogle = provedor === "google_ads" ? "google_presenca" : provedor === "google_presenca" ? "google_ads" : null;
  const outra = outroGoogle ? await lerConexao(db, workspaceId, outroGoogle).catch(() => null) : null;
  const revogacao = conexao
    ? await revogarNaPlataforma({
      provedor, segredos: conexao.segredos, dados: conexao.dados, segredoDoAppMeta: appMeta()?.segredo ?? null,
      outraConexaoGoogleAtiva: Boolean(outra?.segredos.refresh_token),
    })
    : { revogado: false, detalhe: "Não foi possível abrir os tokens salvos para revogar na plataforma." };

  // Apaga a conexão inteira, inclusive o token criptografado, mesmo que a revogação tenha falhado.
  await db.from("conexoes").delete().eq("workspace_id", workspaceId).eq("provedor", provedor);
  revalidatePath(`/painel/${workspaceId}/conexoes`);
  redirect(pagina(workspaceId, revogacao.revogado
    ? "aviso=desconectado-revogado"
    : "aviso=desconectado&motivo=" + encodeURIComponent(revogacao.detalhe.slice(0, 200))));
}
