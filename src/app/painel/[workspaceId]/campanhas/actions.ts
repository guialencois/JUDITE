"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { montarRascunhoComIA } from "@/lib/campanhas/diretor";
import { ativarRascunho, publicarRascunho } from "@/lib/campanhas/publicar";
import { conferirRascunho, rascunhoSchema, type Rascunho } from "@/lib/campanhas/rascunho";
import { exigirDono } from "@/lib/conexoes/acesso";
import { ErroIA, iaConfigurada } from "@/lib/ia";
import { carregarResumo } from "@/lib/diretor/resumo";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";
import { lerLimites, situacaoDoMes } from "@/lib/trafego/mes";
import { PLATAFORMAS } from "@/lib/trafego/tipos";

const pagina = (ws: string, sufixo: string) => `/painel/${ws}/campanhas?${sufixo}`;
type Admin = ReturnType<typeof createAdminClient>;

async function exigirGestor(ws: string) {
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel"));
  return acesso;
}

/** Confere o rascunho pelos freios e grava como aguardando aprovação, com registro no histórico de ações. */
async function gravarRascunho(db: Admin, ws: string, usuarioId: string, origem: "painel" | "diretor", r: Rascunho): Promise<string | null> {
  const [{ data: cfg }, { data: conexoes }, { data: criativos }] = await Promise.all([
    db.from("trafego_config").select("chave, valor").eq("workspace_id", ws),
    db.from("conexoes").select("provedor, conectado_em").eq("workspace_id", ws),
    db.from("criativos").select("id").eq("workspace_id", ws).neq("status", "arquivado"),
  ]);
  const limites = lerLimites(cfg);
  const conferido = conferirRascunho(r, {
    maxSemAprovacao: limites.maxSemAprovacao,
    mes: await situacaoDoMes(db, ws, limites.mensalMax),
    plataformasConectadas: (conexoes ?? []).filter((c) => c.conectado_em).map((c) => c.provedor as string),
    criativosValidos: (criativos ?? []).map((c) => c.id as string),
  });
  if (conferido.erro) return conferido.erro;

  const { data: salvo, error } = await db.from("campanha_rascunhos").insert({
    workspace_id: ws, criado_por: usuarioId, origem, plataforma: r.plataforma, nome: r.nome, objetivo: r.objetivo,
    orcamento_diario: r.orcamento_diario, publico: r.publico, produto_id: r.produto_id, criativo_ids: r.criativo_ids,
    justificativa: r.justificativa || null, avisos: conferido.avisos, status: "aguardando_aprovacao",
  }).select("id").single();
  if (error || !salvo) return "Não foi possível salvar o rascunho. Se a migração da Etapa 9 ainda não foi aplicada no Supabase, aplique-a primeiro.";

  // Campanha nova sempre exige aprovação: fica registrado no histórico de ações do tráfego.
  await db.from("trafego_acoes").insert({
    workspace_id: ws, usuario_id: origem === "painel" ? usuarioId : null, origem: origem === "diretor" ? "automacao" : "painel",
    plataforma: r.plataforma, tipo_entidade: "campanha", entidade_id: (salvo.id as string).slice(0, 36), entidade_nome: r.nome,
    acao: "criar_campanha_pausada", valor_antes: null, valor_depois: String(r.orcamento_diario), status: "aguardando_aprovacao",
    resultado: "Rascunho de campanha nova aguardando a aprovação do dono.",
  });
  return null;
}

const numeroOuNulo = z.string().trim().transform((v) => (v === "" ? null : Number(v))).pipe(z.number().int().min(18).max(65).nullable());

export async function criarRascunho(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  const idades = z.object({ min: numeroOuNulo, max: numeroOuNulo }).safeParse({ min: formData.get("idadeMin") ?? "", max: formData.get("idadeMax") ?? "" });
  const parsed = rascunhoSchema.safeParse({
    plataforma: formData.get("plataforma"),
    nome: formData.get("nome") ?? "",
    objetivo: formData.get("objetivo"),
    orcamento_diario: Number(formData.get("orcamento") ?? 0),
    publico: {
      regiao: String(formData.get("regiao") ?? ""), interesses: String(formData.get("interesses") ?? ""),
      idade_min: idades.success ? idades.data.min : null, idade_max: idades.success ? idades.data.max : null,
    },
    produto_id: String(formData.get("produtoId") ?? "") || null,
    criativo_ids: formData.getAll("criativoIds").map(String).filter(Boolean),
    justificativa: String(formData.get("justificativa") ?? ""),
  });
  if (!parsed.success || !idades.success) redirect(pagina(ws, "erro=rascunho"));

  const erro = await gravarRascunho(createAdminClient(), ws, acesso.userId, "painel", parsed.data);
  revalidatePath(`/painel/${ws}/campanhas`);
  redirect(pagina(ws, erro ? "erro=conferencia&motivo=" + encodeURIComponent(erro.slice(0, 200)) : "aviso=rascunho"));
}

/** Pede ao Diretor (IA) um rascunho para um produto cadastrado. */
export async function pedirRascunhoAoDiretor(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  if (!iaConfigurada()) redirect(pagina(ws, "erro=sem-chave"));
  const parsed = z.object({ produtoId: z.uuid(), orientacao: z.string().trim().max(300) })
    .safeParse({ produtoId: formData.get("produtoId"), orientacao: formData.get("orientacao") ?? "" });
  if (!parsed.success) redirect(pagina(ws, "erro=produto"));

  const db = createAdminClient();
  const [{ data: produto }, { data: criativos }, { data: recente }] = await Promise.all([
    db.from("produtos").select("id, nome, descricao, preco, detalhes, publico").eq("id", parsed.data.produtoId).eq("workspace_id", ws).maybeSingle(),
    db.from("criativos").select("id, plataforma, formato, titulo, descricao").eq("workspace_id", ws).eq("produto_id", parsed.data.produtoId)
      .eq("status", "aprovado").order("criado_em", { ascending: false }).limit(12),
    db.from("campanha_rascunhos").select("criado_em").eq("workspace_id", ws).eq("origem", "diretor").order("criado_em", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!produto) redirect(pagina(ws, "erro=produto"));
  if (recente && Date.now() - new Date(recente.criado_em as string).getTime() < 60_000) redirect(pagina(ws, "erro=recente"));

  let rascunho: Rascunho;
  try {
    rascunho = await montarRascunhoComIA({
      resumo: await carregarResumo(db, ws),
      produto: {
        id: produto.id as string, nome: produto.nome as string, descricao: (produto.descricao as string | null) ?? null,
        preco: produto.preco === null || produto.preco === undefined ? null : Number(produto.preco),
        detalhes: (produto.detalhes as string | null) ?? null, publico: (produto.publico as string | null) ?? null,
      },
      criativos: (criativos ?? []).map((c) => ({
        id: c.id as string, plataforma: (c.plataforma as string | null) ?? null, formato: c.formato as string,
        titulo: c.titulo as string, descricao: (c.descricao as string | null) ?? null,
      })),
      plataformasPermitidas: [...PLATAFORMAS],
      orientacao: parsed.data.orientacao || null,
    });
  } catch (erro) {
    const motivo = erro instanceof ErroIA ? erro.message : "A IA devolveu um rascunho fora das regras (valor ou formato inválido).";
    redirect(pagina(ws, "erro=ia&motivo=" + encodeURIComponent(motivo.slice(0, 200))));
  }

  const erro = await gravarRascunho(db, ws, acesso.userId, "diretor", rascunho);
  revalidatePath(`/painel/${ws}/campanhas`);
  redirect(pagina(ws, erro ? "erro=conferencia&motivo=" + encodeURIComponent(erro.slice(0, 200)) : "aviso=rascunho-ia"));
}

const decisaoSchema = z.object({ workspaceId: z.uuid(), rascunhoId: z.uuid(), decisao: z.enum(["aprovar", "recusar", "ativar"]) });

/** Aprovar (cria a campanha PAUSADA), recusar ou ativar (segunda aprovação). SÓ O DONO. */
export async function decidirRascunho(formData: FormData) {
  const parsed = decisaoSchema.safeParse({
    workspaceId: formData.get("workspaceId"), rascunhoId: formData.get("rascunhoId"), decisao: formData.get("decisao"),
  });
  if (!parsed.success) redirect("/painel");
  const { workspaceId: ws, rascunhoId, decisao } = parsed.data;
  const dono = await exigirDono(ws);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));
  const db = createAdminClient();

  if (decisao === "recusar") {
    await db.from("campanha_rascunhos").update({ status: "recusada", decidido_por: dono.userId, decidido_em: new Date().toISOString() })
      .eq("id", rascunhoId).eq("workspace_id", ws).eq("status", "aguardando_aprovacao");
    revalidatePath(`/painel/${ws}/campanhas`);
    redirect(pagina(ws, "aviso=recusada"));
  }

  const r = decisao === "aprovar" ? await publicarRascunho(db, ws, rascunhoId, dono.userId) : await ativarRascunho(db, ws, rascunhoId, dono.userId);
  revalidatePath(`/painel/${ws}/campanhas`);
  redirect(pagina(ws, r.ok
    ? `aviso=${decisao === "aprovar" ? "publicada" : "ativada"}${r.simulada ? "-simulada" : ""}`
    : "erro=plataforma&motivo=" + encodeURIComponent(r.motivo.slice(0, 200))));
}
