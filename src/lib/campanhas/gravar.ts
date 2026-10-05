/**
 * Monta (com a IA) e grava rascunhos de campanha. SOMENTE no servidor, e só depois de conferir
 * quem pediu (sessão de dono/admin ou segredo do cron). Usado pela página Campanhas, pelo
 * Diretor de Tráfego e pela proposta automática diária.
 *
 * Um rascunho NUNCA cria nada na plataforma: ele fica "aguardando_aprovacao" até o dono decidir.
 */

import { carregarResumo } from "@/lib/diretor/resumo";
import type { createAdminClient } from "@/lib/supabase/admin";
import { lerLimites, situacaoDoMes } from "@/lib/trafego/mes";
import { PLATAFORMAS } from "@/lib/trafego/tipos";
import { montarRascunhoComIA } from "./diretor";
import { conferirRascunho, type Rascunho } from "./rascunho";

type Admin = ReturnType<typeof createAdminClient>;

/** Confere o rascunho pelos freios e grava como aguardando aprovação, com registro no histórico de ações. */
export async function gravarRascunho(db: Admin, ws: string, usuarioId: string | null, origem: "painel" | "diretor", r: Rascunho): Promise<string | null> {
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

/**
 * Pede à IA um rascunho para um produto cadastrado, usando os dados reais do workspace e os
 * criativos aprovados do produto. Devolve null se o produto não for deste workspace.
 * Lança ErroIA (ou erro de validação do zod) quando a IA falha ou devolve algo fora das regras.
 */
export async function montarRascunhoDoProduto(db: Admin, ws: string, produtoId: string, orientacao: string | null): Promise<Rascunho | null> {
  const [{ data: produto }, { data: criativos }] = await Promise.all([
    db.from("produtos").select("id, nome, descricao, preco, detalhes, publico").eq("id", produtoId).eq("workspace_id", ws).maybeSingle(),
    db.from("criativos").select("id, plataforma, formato, titulo, descricao").eq("workspace_id", ws).eq("produto_id", produtoId)
      .eq("status", "aprovado").order("criado_em", { ascending: false }).limit(12),
  ]);
  if (!produto) return null;

  return montarRascunhoComIA({
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
    orientacao,
  });
}
