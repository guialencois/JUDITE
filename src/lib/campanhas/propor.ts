/**
 * Proposta automática de campanha: a JUDITE escolhe sozinha um produto cadastrado e monta um
 * rascunho com a IA. O rascunho fica "aguardando_aprovacao" na página Diretor de Tráfego:
 * nada é criado na plataforma e nenhum centavo é gasto até o dono aprovar (e a campanha nasce PAUSADA).
 *
 * A escolha do produto é determinística (escolherProduto, coberta por testes); a IA só escreve o rascunho.
 */

import { ErroIA, iaConfigurada, mensagemSemChave } from "@/lib/ia";
import type { createAdminClient } from "@/lib/supabase/admin";
import { gravarRascunho, montarRascunhoDoProduto } from "./gravar";

type Admin = ReturnType<typeof createAdminClient>;

/** No máximo estas propostas da JUDITE esperando avaliação ao mesmo tempo (para não acumular). */
export const MAX_PROPOSTAS_PENDENTES = 2;
/** Depois de uma recusa, a JUDITE espera estes dias antes de propor o mesmo produto de novo. */
export const DIAS_APOS_RECUSA = 14;

/** Rascunhos nestas situações "ocupam" o produto: não faz sentido propor outra campanha para ele. */
const EM_ANDAMENTO = ["aguardando_aprovacao", "publicada_pausada", "ativa"];

export type ProdutoSimples = { id: string; nome: string };
export type RascunhoSimples = { produto_id: string | null; origem: string; status: string; criado_em: string };
export type Escolha = { produto: ProdutoSimples; motivo?: undefined } | { produto: null; motivo: string };

/** Decide para qual produto propor uma campanha hoje. Função pura. */
export function escolherProduto(produtos: ProdutoSimples[], rascunhos: RascunhoSimples[], agora: Date = new Date()): Escolha {
  if (!produtos.length) return { produto: null, motivo: "Cadastre pelo menos um produto no Creative Studio para a JUDITE propor campanhas." };

  const pendentes = rascunhos.filter((r) => r.origem === "diretor" && r.status === "aguardando_aprovacao").length;
  if (pendentes >= MAX_PROPOSTAS_PENDENTES) {
    return { produto: null, motivo: `Já há ${pendentes} propostas da JUDITE aguardando a sua avaliação. Aprove ou recuse antes de pedir outra.` };
  }

  const limiteRecusa = agora.getTime() - DIAS_APOS_RECUSA * 864e5;
  const livres = produtos.filter((p) => !rascunhos.some((r) => r.produto_id === p.id && (
    EM_ANDAMENTO.includes(r.status) || (r.status === "recusada" && new Date(r.criado_em).getTime() >= limiteRecusa)
  )));
  if (!livres.length) {
    return { produto: null, motivo: "Todos os produtos já têm campanha proposta, criada ou recusada há pouco tempo. Nada novo a propor hoje." };
  }

  // Prioridade para o produto que nunca recebeu proposta; depois, o que está há mais tempo sem uma.
  const ultima = (id: string) => Math.max(0, ...rascunhos.filter((r) => r.produto_id === id).map((r) => new Date(r.criado_em).getTime()));
  const [escolhido] = [...livres].sort((a, b) => ultima(a.id) - ultima(b.id) || a.nome.localeCompare(b.nome, "pt-BR"));
  return { produto: escolhido };
}

export type ResultadoProposta = { ok: true; nome: string; produto: string } | { ok: false; motivo: string };

/** Monta e grava uma proposta de campanha. usuarioId = quem clicou no botão; null quando é o cron. */
export async function proporCampanha(db: Admin, workspaceId: string, usuarioId: string | null): Promise<ResultadoProposta> {
  if (!iaConfigurada()) return { ok: false, motivo: mensagemSemChave() };

  const [{ data: produtos, error: erroProdutos }, { data: rascunhos, error: erroRascunhos }] = await Promise.all([
    db.from("produtos").select("id, nome").eq("workspace_id", workspaceId).eq("ativo", true).order("nome"),
    db.from("campanha_rascunhos").select("produto_id, origem, status, criado_em").eq("workspace_id", workspaceId)
      .order("criado_em", { ascending: false }).limit(200),
  ]);
  if (erroProdutos || erroRascunhos) {
    return { ok: false, motivo: "As tabelas de produtos e rascunhos ainda não existem no banco (migrações das Etapas 8 e 9)." };
  }

  const escolha = escolherProduto((produtos ?? []) as ProdutoSimples[], (rascunhos ?? []) as RascunhoSimples[]);
  if (!escolha.produto) return { ok: false, motivo: escolha.motivo };

  try {
    const rascunho = await montarRascunhoDoProduto(db, workspaceId, escolha.produto.id, null);
    if (!rascunho) return { ok: false, motivo: "O produto escolhido não existe mais." };
    const erro = await gravarRascunho(db, workspaceId, usuarioId, "diretor", rascunho);
    if (erro) return { ok: false, motivo: "A proposta não passou na conferência: " + erro };
    return { ok: true, nome: rascunho.nome, produto: escolha.produto.nome };
  } catch (erro) {
    return { ok: false, motivo: erro instanceof ErroIA ? erro.message : "A IA devolveu uma proposta fora das regras (valor ou formato inválido)." };
  }
}
