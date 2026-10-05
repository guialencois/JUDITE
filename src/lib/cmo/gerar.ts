/**
 * O motor da CMO: transforma um pedido ("crie uma campanha", "faça para mim", a proposta do dia)
 * numa proposta completa na fila de aprovação. Cada etapa é separada e deixa um registro:
 *
 *   coleta → análise → decisão → geração (IA) → conferência → fila
 *
 * Nada aqui cria campanha na plataforma nem gasta dinheiro: o resultado é sempre um rascunho
 * "aguardando_aprovacao". Banco e IA entram por dependências injetadas (as reais ficam em servico.ts),
 * então o fluxo inteiro é testado sem rede (gerar.test.ts).
 */

import { LIMITES_DESCRICAO, LIMITES_TITULO } from "@/lib/criativos/gerar";
import type { ResumoDiretor } from "@/lib/diretor/tipos";
import { ErroIA, type RespostaIA } from "@/lib/ia";
import type { SituacaoDoMes } from "@/lib/trafego/limites";
import type { LimitesDoWorkspace } from "@/lib/trafego/mes";
import type { Plataforma } from "@/lib/trafego/tipos";
import type { Rascunho } from "@/lib/campanhas/rascunho";
import { instrucoesDaCMO, planoIaSchema, type PlanoIA } from "./agentes";
import { orcamentoInicial, orcamentoInvalido } from "./financeiro";
import { decidirOportunidade, type CampanhaExistente, type Objetivo, type ProdutoCMO, type TipoDeOportunidade } from "./oportunidades";
import { conferirPlano, type ModoDeCriacao, type PlanoFinal } from "./plano";

/** Tudo o que a CMO sabe sobre o workspace na hora de decidir (etapa de coleta). */
export type ContextoCMO = {
  resumo: ResumoDiretor;
  produtos: ProdutoCMO[];
  campanhas: CampanhaExistente[];
  limites: LimitesDoWorkspace;
  mes: SituacaoDoMes;
  /** Situação do mês por canal, só para os canais que têm teto próprio. */
  canais: Partial<Record<Plataforma, SituacaoDoMes>>;
  aprendizados: string[];
};

export type PedidoDeCampanha = {
  workspaceId: string;
  /** Quem pediu; null quando é o ciclo automático. */
  usuarioId: string | null;
  modo: ModoDeCriacao;
  produtoId?: string | null;
  plataforma?: Plataforma | null;
  objetivo?: Objetivo | null;
  tipo?: TipoDeOportunidade | null;
  orcamento?: number | null;
  publico?: string | null;
  regiao?: string | null;
  observacao?: string | null;
};

export type NomeDaEtapa = "monitoramento" | "coleta" | "analise" | "decisao" | "geracao" | "conferencia" | "fila";
export type Etapa = { etapa: NomeDaEtapa; ok: boolean; detalhe: string; ms: number };
export type CodigoDeFalha = "sem_ia" | "sem_oportunidade" | "orcamento" | "ia" | "conferencia" | "fila" | "coleta";

export type ResultadoDaGeracao =
  | { ok: true; rascunhoId: string; nome: string; produto: string; etapas: Etapa[] }
  | { ok: false; codigo: CodigoDeFalha; motivo: string; etapas: Etapa[] };

export type Proposta = { rascunho: Rascunho; plano: PlanoFinal; produto: ProdutoCMO };

export type Dependencias = {
  /** A IA está configurada? Se não, o motivo (qual variável falta). */
  iaPronta(): boolean;
  motivoSemIa(): string;
  carregarContexto(workspaceId: string): Promise<ContextoCMO>;
  pedirPlano(sistema: string, usuario: string): Promise<RespostaIA<unknown>>;
  /** Grava a proposta na fila (aguardando aprovação) e devolve o id, ou o motivo de não ter gravado. */
  salvar(pedido: PedidoDeCampanha, proposta: Proposta): Promise<{ id: string } | { erro: string }>;
  agora?(): number;
};

export async function gerarCampanha(deps: Dependencias, pedido: PedidoDeCampanha): Promise<ResultadoDaGeracao> {
  const relogio = deps.agora ?? Date.now;
  const etapas: Etapa[] = [];
  let inicio = relogio();
  const marcar = (etapa: NomeDaEtapa, ok: boolean, detalhe: string) => {
    etapas.push({ etapa, ok, detalhe: detalhe.slice(0, 300), ms: Math.max(0, relogio() - inicio) });
    inicio = relogio();
  };
  const falhar = (etapa: NomeDaEtapa, codigo: CodigoDeFalha, motivo: string): ResultadoDaGeracao => {
    marcar(etapa, false, motivo);
    return { ok: false, codigo, motivo, etapas };
  };

  // Sem IA não há como escrever o plano: avisa antes de gastar qualquer leitura.
  if (!deps.iaPronta()) return falhar("coleta", "sem_ia", deps.motivoSemIa());
  if (pedido.orcamento !== null && pedido.orcamento !== undefined) {
    const invalido = orcamentoInvalido(pedido.orcamento);
    if (invalido) return falhar("coleta", "orcamento", invalido);
  }

  // 1. COLETA
  let ctx: ContextoCMO;
  try {
    ctx = await deps.carregarContexto(pedido.workspaceId);
  } catch {
    return falhar("coleta", "coleta", "Não foi possível ler os dados do workspace. Confira se as migrações foram aplicadas no Supabase.");
  }
  marcar("coleta", true, `${ctx.produtos.length} produto(s), ${ctx.campanhas.length} campanha(s) da JUDITE, ${ctx.resumo.campanhas.length} campanha(s) nas plataformas.`);

  // 2 e 3. ANÁLISE e DECISÃO (regras fixas, sem IA)
  const decisao = decidirOportunidade({
    produtos: ctx.produtos, campanhas: ctx.campanhas, resumo: ctx.resumo, bloqueadas: ctx.limites.bloqueadas,
    filtro: { produtoId: pedido.produtoId, plataforma: pedido.plataforma, objetivo: pedido.objetivo, tipo: pedido.tipo },
  }, { respeitarFila: pedido.modo === "diario" });
  if (!decisao.oportunidade) return falhar("analise", "sem_oportunidade", decisao.motivo);
  const op = decisao.oportunidade;
  marcar("analise", true, `${decisao.alternativas.length + 1} oportunidade(s) válida(s) encontradas.`);

  const financeiro = orcamentoInicial({ maxSemAprovacao: ctx.limites.maxSemAprovacao, mes: ctx.mes, canal: ctx.canais[op.plataforma] ?? null });
  if (financeiro.recomendado <= 0 && (pedido.orcamento === null || pedido.orcamento === undefined)) {
    return falhar("decisao", "orcamento", financeiro.explicacao);
  }
  marcar("decisao", true, `${op.produto.nome} · ${op.plataforma} · ${op.tipo} (${op.pontos} pontos, confiança ${op.confianca}).`);

  // 4. GERAÇÃO (IA): a CMO coordena os especialistas e devolve um plano no formato do schema.
  const entrada = {
    produto: {
      nome: op.produto.nome, descricao: op.produto.descricao, preco: op.produto.preco, detalhes: op.produto.detalhes, publico: op.produto.publico,
    },
    oportunidade: {
      tipo: op.tipo, plataforma: op.plataforma, objetivo: op.objetivo, etapa_funil: op.funil, segmentacao: op.segmentacao,
      motivo: op.motivo, dados: op.dados, ressalvas: op.ressalvas, confianca: op.confianca,
    },
    financeiro: { recomendado: financeiro.recomendado, teto: financeiro.teto, explicacao: financeiro.explicacao },
    limites_de_texto: { titulo: LIMITES_TITULO[op.plataforma], descricao: LIMITES_DESCRICAO[op.plataforma] },
    pedido: {
      orcamento_diario_pedido: pedido.orcamento ?? null, publico_informado: pedido.publico || null,
      regiao_informada: pedido.regiao || null, observacao: pedido.observacao || null,
    },
    aprendizados_anteriores: ctx.aprendizados.slice(0, 10),
    resumo_do_negocio: ctx.resumo,
  };
  const usuario = "Monte o plano da campanha para estes dados (JSON):\n" + JSON.stringify(entrada);

  let resposta: RespostaIA<unknown>;
  try {
    resposta = await deps.pedirPlano(instrucoesDaCMO(), usuario);
  } catch (erro) {
    return falhar("geracao", "ia", erro instanceof ErroIA ? erro.message : "Erro inesperado ao falar com a IA.");
  }
  const lido = planoIaSchema.safeParse(resposta.dados);
  if (!lido.success) return falhar("geracao", "ia", "A IA respondeu fora do formato esperado. Tente de novo.");
  const ia: PlanoIA = lido.data;
  marcar("geracao", true, `Plano escrito pelo modelo ${resposta.modelo} (${resposta.tokensEntrada} + ${resposta.tokensSaida} tokens).`);

  // 5. CONFERÊNCIA (código): o que a pessoa pediu e os limites vencem a IA.
  const conferido = conferirPlano(ia, {
    modo: pedido.modo, oportunidade: op, alternativas: decisao.alternativas, financeiro, bloqueadas: ctx.limites.bloqueadas,
    pedido: { plataforma: pedido.plataforma, objetivo: pedido.objetivo, orcamento: pedido.orcamento },
    fonte: usuario, modelo: resposta.modelo,
  });
  if (!conferido.ok) return falhar("conferencia", "conferencia", conferido.erro);
  marcar("conferencia", true, `${conferido.plano.anuncios.length} anúncio(s) aceito(s), ${conferido.plano.anuncios_descartados.length} descartado(s), ${conferido.plano.avisos.length} aviso(s).`);

  // 6. FILA: grava como "aguardando aprovação". Nada é criado na plataforma.
  const salvo = await deps.salvar(pedido, { rascunho: conferido.rascunho, plano: conferido.plano, produto: op.produto });
  if ("erro" in salvo) return falhar("fila", "fila", salvo.erro);
  marcar("fila", true, "Proposta na fila, aguardando aprovação.");

  return { ok: true, rascunhoId: salvo.id, nome: conferido.rascunho.nome, produto: op.produto.nome, etapas };
}
