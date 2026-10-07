"use server";

/**
 * Ações da seção Windsor.ai da página Conexões. Só o DONO do workspace salva, testa ou troca a fonte.
 * A chave é conferida na própria Windsor antes de ser guardada (criptografada) e nunca volta para a tela.
 * Apagar a chave usa a ação "desconectar" de actions.ts, como as outras conexões.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { registrarConta } from "@/lib/conexoes/contas";
import { gravarConexao, lerConexao } from "@/lib/conexoes/segredos";
import { createAdminClient } from "@/lib/supabase/admin";
import { contaCanonica, lerDadosWindsor, type ConectorWindsor } from "@/lib/windsor/conexao";
import { listarContasWindsor } from "@/lib/windsor/mcp";

const wsSchema = z.uuid();
const pagina = (ws: string, sufixo: string) => `/painel/${ws}/conexoes?${sufixo}#windsor`;
const idConta = z.string().regex(/^[\x21-\x7E]{1,200}$/);

/** Confere a chave na Windsor. Devolve as contas ou o código do erro para a tela. */
async function conferir(chave: string) {
  try {
    return { ok: true as const, contas: await listarContasWindsor(chave) };
  } catch (erro) {
    const recusada = (erro as { status?: number } | null)?.status === 401;
    return { ok: false as const, codigo: recusada ? "windsor-chave" : "windsor-fora" };
  }
}

const chaveSchema = z.object({
  workspaceId: wsSchema,
  // Sem espaços nem caracteres de controle; o formato exato quem valida é a Windsor.
  chave: z.string().trim().regex(/^[\x21-\x7E]{16,300}$/),
});

/** Testa a chave na Windsor e, se ela valer, guarda criptografada junto com a lista de contas ligadas lá. */
export async function salvarChaveWindsor(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const parsed = chaveSchema.safeParse({ workspaceId: ws, chave: formData.get("chave") ?? "" });
  if (!parsed.success) redirect(wsSchema.safeParse(ws).success ? pagina(ws, "erro=windsor-dados") : "/painel");
  const dono = await exigirDono(parsed.data.workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const teste = await conferir(parsed.data.chave);
  if (!teste.ok) redirect(pagina(ws, `erro=${teste.codigo}`));

  const { error } = await gravarConexao(createAdminClient(), parsed.data.workspaceId, "windsor", dono.userId, {
    dados: { contas: teste.contas, validado_em: new Date().toISOString() },
    segredos: { api_key: parsed.data.chave },
  });
  if (error) redirect(pagina(ws, "erro=windsor-salvar"));
  revalidatePath(`/painel/${ws}/conexoes`);
  redirect(pagina(ws, "aviso=windsor-salva"));
}

/** Confere de novo a chave salva e atualiza a lista de contas (depois de ligar uma conta nova na Windsor). */
export async function atualizarContasWindsor(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  if (!wsSchema.safeParse(ws).success) redirect("/painel");
  const dono = await exigirDono(ws);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const db = createAdminClient();
  const conexao = await lerConexao(db, ws, "windsor").catch(() => null);
  if (!conexao?.segredos.api_key) redirect(pagina(ws, "erro=windsor-sem-chave"));
  const teste = await conferir(conexao.segredos.api_key);
  if (!teste.ok) redirect(pagina(ws, `erro=${teste.codigo}`));

  const { error } = await gravarConexao(db, ws, "windsor", dono.userId, {
    dados: { contas: teste.contas, validado_em: new Date().toISOString() },
  });
  if (error) redirect(pagina(ws, "erro=windsor-salvar"));
  revalidatePath(`/painel/${ws}/conexoes`);
  redirect(pagina(ws, "aviso=windsor-atualizada"));
}

const fonteSchema = z.object({
  workspaceId: wsSchema,
  plataforma: z.enum(["google_ads", "facebook", "tiktok"]),
  fonte: z.enum(["propria", "windsor"]),
  contas: z.array(idConta).max(50),
});

/**
 * Seletor por plataforma: "Windsor" ou "Conexão própria (OAuth)", e quais contas da Windsor a JUDITE usa.
 * As contas precisam estar na lista que a Windsor devolveu para a chave deste workspace, e passam pela
 * mesma trava das conexões nativas: uma conta de anúncios não pode pertencer a dois workspaces.
 */
export async function salvarFonteWindsor(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const parsed = fonteSchema.safeParse({
    workspaceId: ws, plataforma: formData.get("plataforma"), fonte: formData.get("fonte"),
    contas: formData.getAll("contas").map(String),
  });
  if (!parsed.success) redirect(wsSchema.safeParse(ws).success ? pagina(ws, "erro=windsor-dados") : "/painel");
  const { workspaceId, plataforma, fonte } = parsed.data;
  const dono = await exigirDono(workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const db = createAdminClient();
  const conexao = await lerConexao(db, workspaceId, "windsor").catch(() => null);
  if (!conexao?.segredos.api_key) redirect(pagina(ws, "erro=windsor-sem-chave"));
  const atual = lerDadosWindsor(conexao.dados);

  const disponiveis = atual.contas[plataforma] ?? [];
  const escolhidas = disponiveis.filter((c) => parsed.data.contas.includes(c.id));
  if (escolhidas.length !== new Set(parsed.data.contas).size) redirect(pagina(ws, "erro=windsor-conta"));
  if (fonte === "windsor" && !escolhidas.length) redirect(pagina(ws, "erro=windsor-escolher"));

  for (const c of escolhidas) {
    if (!(await registrarConta(db, workspaceId, plataforma, contaCanonica(plataforma, c.id), c.nome))) {
      redirect(pagina(ws, "erro=conta-de-outro"));
    }
  }
  const { error } = await gravarConexao(db, workspaceId, "windsor", dono.userId, {
    dados: {
      fonte: { ...atual.fonte, [plataforma]: fonte },
      escolhidas: { ...atual.escolhidas, [plataforma]: escolhidas.map((c) => c.id) },
    },
  });
  if (error) redirect(pagina(ws, "erro=windsor-salvar"));
  revalidatePath(`/painel/${ws}`, "layout");
  redirect(pagina(ws, fonte === "windsor" ? "aviso=windsor-fonte" : "aviso=windsor-propria"));
}

const presencaSchema = z.object({
  workspaceId: wsSchema,
  fonte: z.enum(["propria", "windsor"]),
  local: z.union([z.literal(""), idConta]),
  site: z.union([z.literal(""), idConta]),
});

/** Presença no Google: ler o Perfil da Empresa e o Search Console pela Windsor (só leitura) ou pela conexão própria. */
export async function salvarPresencaWindsor(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const parsed = presencaSchema.safeParse({
    workspaceId: ws, fonte: formData.get("fonte"), local: formData.get("local") ?? "", site: formData.get("site") ?? "",
  });
  if (!parsed.success) redirect(wsSchema.safeParse(ws).success ? pagina(ws, "erro=windsor-dados") : "/painel");
  const { workspaceId, fonte, local, site } = parsed.data;
  const dono = await exigirDono(workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const db = createAdminClient();
  const conexao = await lerConexao(db, workspaceId, "windsor").catch(() => null);
  if (!conexao?.segredos.api_key) redirect(pagina(ws, "erro=windsor-sem-chave"));
  const atual = lerDadosWindsor(conexao.dados);

  const existe = (conector: ConectorWindsor, id: string) => !id || (atual.contas[conector] ?? []).some((c) => c.id === id);
  if (!existe("google_my_business", local) || !existe("searchconsole", site)) redirect(pagina(ws, "erro=windsor-conta"));
  if (fonte === "windsor" && !local && !site) redirect(pagina(ws, "erro=windsor-escolher"));

  const { error } = await gravarConexao(db, workspaceId, "windsor", dono.userId, {
    dados: {
      fonte: { ...atual.fonte, presenca: fonte },
      escolhidas: { ...atual.escolhidas, google_my_business: local ? [local] : [], searchconsole: site ? [site] : [] },
    },
  });
  if (error) redirect(pagina(ws, "erro=windsor-salvar"));
  revalidatePath(`/painel/${ws}`, "layout");
  redirect(pagina(ws, fonte === "windsor" ? "aviso=windsor-fonte" : "aviso=windsor-propria"));
}
