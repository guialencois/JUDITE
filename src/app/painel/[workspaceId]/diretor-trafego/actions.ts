"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { editarProposta, mudarCampanha } from "@/lib/campanhas/ciclo-de-vida";
import { exigirDono } from "@/lib/conexoes/acesso";
import { podeDefinirNivel } from "@/lib/cmo/niveis";
import { TIPOS_DE_OPORTUNIDADE } from "@/lib/cmo/oportunidades";
import { criarCampanha, ideiasDeCampanha } from "@/lib/cmo/servico";
import type { PedidoDeCampanha } from "@/lib/cmo/gerar";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";
import { executarAcao } from "@/lib/trafego/executar";
import { PLATAFORMAS, type Plataforma } from "@/lib/trafego/tipos";

const pagina = (ws: string, sufixo: string) => `/painel/${ws}/diretor-trafego?${sufixo}`;
const comMotivo = (codigo: string, motivo: string) => `erro=${codigo}&motivo=` + encodeURIComponent(motivo.slice(0, 200));
/** Intervalo mínimo entre pedidos à IA pelo mesmo workspace (cada um gasta cota). */
const INTERVALO_MINIMO_MS = 60_000;

type Admin = ReturnType<typeof createAdminClient>;

async function exigirGestor(ws: string) {
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel"));
  return acesso;
}

function revalidar(ws: string) {
  revalidatePath(`/painel/${ws}/diretor-trafego`);
  revalidatePath(`/painel/${ws}/campanhas`);
}

/** Freio simples de frequência: um pedido de geração por minuto por workspace. */
async function pedidoRecente(db: Admin, ws: string): Promise<boolean> {
  const { data } = await db.from("campanha_rascunhos").select("criado_em").eq("workspace_id", ws).eq("origem", "diretor")
    .order("criado_em", { ascending: false }).limit(1).maybeSingle();
  return Boolean(data && Date.now() - new Date(data.criado_em as string).getTime() < INTERVALO_MINIMO_MS);
}

async function gerar(ws: string, pedido: Omit<PedidoDeCampanha, "workspaceId" | "usuarioId">) {
  const acesso = await exigirGestor(ws);
  const db = createAdminClient();
  if (await pedidoRecente(db, ws)) redirect(pagina(ws, "erro=recente"));
  const r = await criarCampanha(db, { ...pedido, workspaceId: ws, usuarioId: acesso.userId });
  revalidar(ws);
  redirect(pagina(ws, r.ok ? "aviso=proposta" : comMotivo("proposta", r.motivo)));
}

/** "Criar automaticamente": a pessoa escolhe só o produto (ou nem isso) e a JUDITE faz o resto. */
export async function criarAutomaticamente(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const produto = z.uuid().safeParse(formData.get("produtoId"));
  await gerar(ws, { modo: "automatico", produtoId: produto.success ? produto.data : null });
}

const opcional = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const guiadaSchema = z.object({
  produtoId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  plataforma: z.union([z.enum(["google_ads", "facebook", "tiktok"]), z.literal("")]).transform((v) => v || null),
  objetivo: z.union([z.enum(["trafego", "mensagens", "conversoes", "reconhecimento"]), z.literal("")]).transform((v) => v || null),
  orcamento: z.string().trim().transform((v) => (v === "" ? null : Number(v.replace(",", ".")))).pipe(z.number().positive().max(5000).nullable()),
  publico: opcional(300),
  regiao: opcional(200),
  observacao: opcional(300),
});

/** "Criar campanha": perguntas mínimas, todas opcionais. O que ficar em branco a JUDITE decide. */
export async function criarGuiada(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const texto = (nome: string) => String(formData.get(nome) ?? "");
  const lido = guiadaSchema.safeParse({
    produtoId: texto("produtoId"), plataforma: texto("plataforma"), objetivo: texto("objetivo"), orcamento: texto("orcamento"),
    publico: texto("publico"), regiao: texto("regiao"), observacao: texto("observacao"),
  });
  if (!lido.success) {
    await exigirGestor(ws);
    redirect(pagina(ws, "erro=pedido"));
  }
  await gerar(ws, { modo: "guiado", ...lido.data });
}

/** "Quero ideias": a JUDITE mostra as melhores oportunidades, explicadas. Não cria campanha. */
export async function pedirIdeias(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  const db = createAdminClient();
  const { data: ultima } = await db.from("campanha_ideias").select("criado_em").eq("workspace_id", ws)
    .order("criado_em", { ascending: false }).limit(1).maybeSingle();
  if (ultima && Date.now() - new Date(ultima.criado_em as string).getTime() < INTERVALO_MINIMO_MS) redirect(pagina(ws, "erro=recente"));

  const r = await ideiasDeCampanha(db, ws, acesso.userId);
  revalidar(ws);
  redirect(pagina(ws, r.ok ? "aviso=ideias" : comMotivo("ideias", r.motivo)));
}

const ideiaSchema = z.object({ workspaceId: z.uuid(), ideiaId: z.uuid(), decisao: z.enum(["gerar", "descartar"]) });

/** Transforma uma ideia em campanha estruturada (vai para a fila) ou descarta a ideia. */
export async function decidirIdeia(formData: FormData) {
  const lido = ideiaSchema.safeParse({ workspaceId: formData.get("workspaceId"), ideiaId: formData.get("ideiaId"), decisao: formData.get("decisao") });
  if (!lido.success) redirect("/painel");
  const { workspaceId: ws, ideiaId, decisao } = lido.data;
  const acesso = await exigirGestor(ws);
  const db = createAdminClient();

  // Reserva a ideia primeiro (só passa quem ainda está "nova"): clique duplo não gera duas campanhas.
  const { data: ideia } = await db.from("campanha_ideias").update({ status: decisao === "gerar" ? "usada" : "descartada" })
    .eq("id", ideiaId).eq("workspace_id", ws).eq("status", "nova")
    .select("produto_id, oportunidade, plataforma, objetivo, titulo, detalhes").maybeSingle();
  revalidar(ws);
  if (!ideia) redirect(pagina(ws, "erro=decisao"));
  if (decisao === "descartar") redirect(pagina(ws, "aviso=ideia-descartada"));

  const tipo = TIPOS_DE_OPORTUNIDADE.find((t) => t === ideia.oportunidade) ?? null;
  const plataforma = PLATAFORMAS.find((p) => p === ideia.plataforma) ?? null;
  const hipotese = (ideia.detalhes as { hipotese?: unknown } | null)?.hipotese;
  const r = await criarCampanha(db, {
    workspaceId: ws, usuarioId: acesso.userId, modo: "ideia", produtoId: (ideia.produto_id as string | null) ?? null, tipo, plataforma,
    observacao: [`Ideia aprovada: ${ideia.titulo}`, typeof hipotese === "string" ? `Hipótese: ${hipotese}` : ""].filter(Boolean).join(" ").slice(0, 300),
  });
  if (!r.ok) {
    // A campanha não saiu: a ideia volta a ficar disponível.
    await db.from("campanha_ideias").update({ status: "nova" }).eq("id", ideiaId).eq("workspace_id", ws).eq("status", "usada");
  }
  revalidar(ws);
  redirect(pagina(ws, r.ok ? "aviso=proposta" : comMotivo("proposta", r.motivo)));
}

const idade = z.string().trim().transform((v) => (v === "" ? null : Number(v))).pipe(z.number().int().min(18).max(65).nullable());
const edicaoSchema = z.object({
  workspaceId: z.uuid(), rascunhoId: z.uuid(),
  nome: z.string().trim().min(3).max(150),
  orcamento: z.coerce.number().positive().max(5000),
  regiao: z.string().trim().max(200), interesses: z.string().trim().max(500),
  idadeMin: idade, idadeMax: idade,
});

/** "Editar" uma proposta antes de aprovar. Só o dono (é ele quem aprova campanha nova). */
export async function editarRascunho(formData: FormData) {
  const texto = (nome: string) => String(formData.get(nome) ?? "");
  const lido = edicaoSchema.safeParse({
    workspaceId: formData.get("workspaceId"), rascunhoId: formData.get("rascunhoId"), nome: texto("nome"), orcamento: texto("orcamento"),
    regiao: texto("regiao"), interesses: texto("interesses"), idadeMin: texto("idadeMin"), idadeMax: texto("idadeMax"),
  });
  const ws = String(formData.get("workspaceId"));
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const dono = await exigirDono(ws);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));
  if (!lido.success) redirect(pagina(ws, "erro=edicao"));

  const { rascunhoId, workspaceId: _ws, ...novo } = lido.data;
  void _ws;
  const r = await editarProposta(createAdminClient(), ws, rascunhoId, dono.userId, novo);
  revalidar(ws);
  redirect(pagina(ws, r.ok ? "aviso=editada" : comMotivo("plataforma", r.motivo)));
}

const vidaSchema = z.object({ workspaceId: z.uuid(), rascunhoId: z.uuid(), acao: z.enum(["pausar", "retomar", "concluir"]) });

/** Pausar (dono ou admin), retomar ou concluir (só o dono) uma campanha criada pela JUDITE. */
export async function mudarSituacao(formData: FormData) {
  const lido = vidaSchema.safeParse({ workspaceId: formData.get("workspaceId"), rascunhoId: formData.get("rascunhoId"), acao: formData.get("acao") });
  if (!lido.success) redirect("/painel");
  const { workspaceId: ws, rascunhoId, acao } = lido.data;
  const acesso = await exigirGestor(ws);
  // Pausar é sempre permitido a quem gerencia; retomar gasta dinheiro e concluir é definitivo: só o dono.
  if (acao !== "pausar" && acesso.papel !== "owner") redirect(pagina(ws, "erro=so-dono"));

  const r = await mudarCampanha(createAdminClient(), ws, rascunhoId, acesso.userId, acao);
  revalidar(ws);
  redirect(pagina(ws, r.ok ? `aviso=${acao}` : comMotivo("plataforma", r.motivo)));
}

/** Nível de autonomia. Só o dono; níveis 3 e 4 ainda não podem ser ligados. */
export async function definirNivel(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  const nivel = Number(formData.get("nivel"));
  const recusa = podeDefinirNivel(nivel, acesso.papel, formData.get("ciente") === "sim");
  if (recusa) redirect(pagina(ws, comMotivo("nivel", recusa)));

  const db = createAdminClient();
  const agora = new Date().toISOString();
  const ligada = nivel >= 2;
  const base: Record<string, unknown> = { workspace_id: ws, ligada, atualizado_em: agora, atualizado_por: acesso.userId, ...(ligada ? { ligada_em: agora } : { desligada_em: agora }) };
  let { error } = await db.from("autonomia").upsert({ ...base, nivel }, { onConflict: "workspace_id" });
  // Antes da migração da CMO a coluna "nivel" não existe. Os níveis 1 e 2 cabem na chave antiga (desligada/ligada).
  if (error && nivel >= 1) ({ error } = await db.from("autonomia").upsert(base, { onConflict: "workspace_id" }));
  revalidatePath(`/painel/${ws}/diretor-trafego`);
  revalidatePath(`/painel/${ws}/diretor`);
  if (error) redirect(pagina(ws, "erro=migracao-nivel"));
  redirect(pagina(ws, `aviso=nivel-${nivel}`));
}

const decisaoSchema = z.object({ workspaceId: z.uuid(), acaoId: z.uuid(), decisao: z.enum(["aprovar", "dispensar"]) });
const ACOES = ["pausar", "ativar", "definir_orcamento"] as const;

/**
 * Aprova ou dispensa uma ação que a autonomia quis fazer mas ficou acima de algum limite.
 * Aprovar aplica a mudança pelo mesmo caminho do Gerenciador (executarAcao): quem clica é um humano
 * com papel de dono ou admin, e o clique vale como a confirmação dos limites.
 */
export async function decidirAcaoPendente(formData: FormData) {
  const parsed = decisaoSchema.safeParse({
    workspaceId: formData.get("workspaceId"), acaoId: formData.get("acaoId"), decisao: formData.get("decisao"),
  });
  if (!parsed.success) redirect("/painel");
  const { workspaceId: ws, acaoId, decisao } = parsed.data;
  const acesso = await exigirGestor(ws);
  const db = createAdminClient();

  // Reserva a linha primeiro (só passa quem ainda está aguardando): evita aplicar duas vezes com clique duplo.
  const { data: pendente, error } = await db.from("trafego_acoes")
    .update({ status: decisao === "aprovar" ? "aprovada" : "dispensada" })
    .eq("id", acaoId).eq("workspace_id", ws).eq("status", "aguardando_aprovacao").eq("origem", "automacao").in("acao", [...ACOES])
    .select("plataforma, entidade_id, entidade_nome, acao, valor_depois").maybeSingle();
  revalidatePath(`/painel/${ws}/diretor-trafego`);
  if (error) redirect(pagina(ws, "erro=migracao"));
  if (!pendente) redirect(pagina(ws, "erro=decisao"));
  if (decisao === "dispensar") redirect(pagina(ws, "aviso=dispensada"));

  const plataforma = PLATAFORMAS.find((p) => p === pendente.plataforma);
  const acao = ACOES.find((a) => a === pendente.acao);
  const valor = acao === "definir_orcamento" ? Number(pendente.valor_depois) : undefined;
  if (!plataforma || !acao || (acao === "definir_orcamento" && !(Number.isFinite(valor) && Number(valor) > 0))) {
    redirect(pagina(ws, comMotivo("execucao", "Os dados dessa ação estão incompletos. Refaça a mudança no Gerenciador.")));
  }

  const r = await executarAcao(db, {
    workspaceId: ws, origem: "painel", usuarioId: acesso.userId, plataforma: plataforma as Plataforma,
    entidadeId: pendente.entidade_id as string, entidadeNome: (pendente.entidade_nome as string | null) ?? undefined,
    acao, valorReais: valor, confirmado: true, observacao: "Ação proposta pela autonomia e aprovada por uma pessoa",
  });
  revalidatePath(`/painel/${ws}/trafego/gerenciador`);
  if (r.tipo === "aplicada") redirect(pagina(ws, "aviso=aplicada"));
  redirect(pagina(ws, comMotivo("execucao", r.tipo === "aguardando_aprovacao" ? r.motivo : r.erro)));
}
