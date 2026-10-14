/**
 * Autonomia supervisionada. DESLIGADA por padrão em todo workspace; só o dono liga, na tela Diretor.
 *
 * Ligada, a JUDITE pode sozinha (uma vez por dia, depois do relatório):
 *   1. PAUSAR campanha com gasto alto e zero conversões, depois do volume mínimo de dados;
 *   2. REDUZIR a verba de campanha com custo por conversão muito acima da média;
 *   3. AUMENTAR a verba de campanha boa, no máximo 10% por ajuste.
 * Toda ação sai por executarAcao() com origem "automacao": os freios de limites.ts valem do mesmo
 * jeito e o que passar de qualquer limite (teto diário, % por ajuste, orçamento do mês) NÃO é
 * aplicado: vira "aguardando_aprovacao". A automação nunca confirma sozinha.
 *
 * As regras são determinísticas (sem IA) e ficam em decidirAutonomia(), coberta por testes.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { executarAcao, type ResultadoAcao } from "@/lib/trafego/executar";
import { PADRAO_AUMENTO_PERCENT } from "@/lib/trafego/limites";
import type { Plataforma } from "@/lib/trafego/tipos";
import { CLIQUES_MINIMOS, CONVERSOES_MINIMAS, DIAS_MINIMOS } from "./regras";
import { carregarResumo } from "./resumo";
import type { CampanhaResumo } from "./tipos";

type Admin = ReturnType<typeof createAdminClient>;

/** Gasto mínimo na janela (14 dias) para considerar "gasto alto" sem nenhuma conversão. */
export const GASTO_ALTO_REAIS = 100;
/** Custo por conversão a partir de quantas vezes a média a verba é reduzida. */
export const FATOR_CARO = 2;
/** Custo por conversão até que fração da média a verba pode subir. */
export const FATOR_BOM = 0.7;
/** Tamanho de cada ajuste de verba feito sozinho (nunca mais que o limite do workspace). */
export const AJUSTE_PERCENT = 10;
/** Abaixo disso a JUDITE não reduz mais (as plataformas têm orçamento mínimo). */
export const ORCAMENTO_MINIMO_REAIS = 5;
/** Depois de mexer numa campanha, espera estes dias antes de mexer de novo (período de aprendizado). */
export const DIAS_DE_ESPERA = 7;
/** No máximo estas ações por dia, por workspace. */
export const MAX_ACOES_POR_RODADA = 3;

export type Decisao = {
  acao: "pausar" | "definir_orcamento";
  plataforma: string;
  campanha_id: string;
  nome: string;
  valorReais?: number;
  motivo: string;
};

export type ContextoAutonomia = {
  /** Limite de aumento por ajuste do workspace (o ajuste automático usa o menor entre ele e 10%). */
  aumentoMaxPercent: number;
  /** Campanhas ("plataforma|id") que já tiveram alguma ação nos últimos DIAS_DE_ESPERA dias. */
  mexidasRecentemente: Set<string>;
};

const chaveDe = (c: { plataforma: string; campanha_id: string }) => `${c.plataforma}|${c.campanha_id}`;
const reais = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");
const arred = (v: number) => Math.round(v * 100) / 100;

/** Decide o que a autonomia faria hoje. Função pura: não fala com banco nem com plataforma. */
export function decidirAutonomia(campanhas: CampanhaResumo[], ctx: ContextoAutonomia): Decisao[] {
  const pausas: Decisao[] = [];
  const reducoes: Decisao[] = [];
  const aumentos: Decisao[] = [];
  const percent = Math.min(AJUSTE_PERCENT, ctx.aumentoMaxPercent > 0 ? ctx.aumentoMaxPercent : PADRAO_AUMENTO_PERCENT);

  // Custo médio por conversão de cada plataforma, só com as campanhas que converteram.
  const cpaMedio = new Map<string, number>();
  for (const plataforma of new Set(campanhas.map((c) => c.plataforma))) {
    const comConversao = campanhas.filter((c) => c.plataforma === plataforma && c.compras > 0);
    const gasto = comConversao.reduce((s, c) => s + c.gasto, 0);
    const compras = comConversao.reduce((s, c) => s + c.compras, 0);
    if (compras > 0) cpaMedio.set(plataforma, gasto / compras);
  }

  for (const c of campanhas) {
    // Volume mínimo e período de aprendizado: sem isso, nenhuma decisão.
    if (!c.ativa || c.dias_com_dados < DIAS_MINIMOS || c.cliques < CLIQUES_MINIMOS) continue;
    if (ctx.mexidasRecentemente.has(chaveDe(c))) continue;
    const media = cpaMedio.get(c.plataforma);
    const base = { plataforma: c.plataforma, campanha_id: c.campanha_id, nome: c.nome };

    if (c.compras === 0) {
      // "Zero conversões" só é sinal de campanha ruim se a plataforma está medindo conversões
      // (alguma outra campanha converteu). Sem isso, pode ser só falta de rastreamento: não pausa.
      if (media !== undefined && c.gasto >= GASTO_ALTO_REAIS) {
        pausas.push({
          ...base, acao: "pausar",
          motivo: `Gastou ${reais(c.gasto)} em ${c.dias_com_dados} dias, com ${c.cliques} cliques e nenhuma conversão.`,
        });
      }
      continue;
    }
    if (media === undefined || c.orcamento_diario === null || !(c.orcamento_diario > 0)) continue;
    const cpa = c.gasto / c.compras;

    if (cpa >= media * FATOR_CARO) {
      const novo = arred(c.orcamento_diario * (1 - percent / 100));
      if (novo >= ORCAMENTO_MINIMO_REAIS) {
        reducoes.push({
          ...base, acao: "definir_orcamento", valorReais: novo,
          motivo: `Custo por conversão de ${reais(cpa)}, ${FATOR_CARO}x ou mais acima da média de ${reais(media)}. Redução de ${percent}%.`,
        });
      }
    } else if (cpa <= media * FATOR_BOM && c.compras >= CONVERSOES_MINIMAS) {
      aumentos.push({
        ...base, acao: "definir_orcamento", valorReais: arred(c.orcamento_diario * (1 + percent / 100)),
        motivo: `Custo por conversão de ${reais(cpa)}, bem abaixo da média de ${reais(media)}, com ${c.compras} conversões. Aumento de ${percent}%.`,
      });
    }
  }
  // Prioridade: primeiro parar de perder dinheiro, depois reduzir, por último aumentar.
  return [...pausas, ...reducoes, ...aumentos].slice(0, MAX_ACOES_POR_RODADA);
}

export async function autonomiaLigada(db: Admin, workspaceId: string): Promise<boolean> {
  // Sem linha (ou sem a tabela, antes da migração) = desligada.
  const { data } = await db.from("autonomia").select("ligada").eq("workspace_id", workspaceId).maybeSingle();
  return data?.ligada === true;
}

export type RodadaAutonomia = { ligada: boolean; acoes: { nome: string; acao: string; resultado: ResultadoAcao["tipo"]; detalhe: string }[] };

/** Roda a autonomia de um workspace. Chamado só pelo cron (depois de conferido o segredo). */
export async function rodarAutonomia(db: Admin, workspaceId: string): Promise<RodadaAutonomia> {
  if (!(await autonomiaLigada(db, workspaceId))) return { ligada: false, acoes: [] };

  const resumo = await carregarResumo(db, workspaceId);
  const desde = new Date(Date.now() - DIAS_DE_ESPERA * 864e5).toISOString();
  const { data: recentes } = await db.from("trafego_acoes").select("plataforma, entidade_id")
    .eq("workspace_id", workspaceId).gte("criado_em", desde).limit(1000);

  const decisoes = decidirAutonomia(resumo.campanhas, {
    aumentoMaxPercent: resumo.limites.aumento_max_por_ajuste_percent,
    mexidasRecentemente: new Set((recentes ?? []).map((a) => `${a.plataforma}|${a.entidade_id}`)),
  });

  const acoes: RodadaAutonomia["acoes"] = [];
  for (const d of decisoes) {
    // Confere de novo a cada ação: o botão "Parar tudo" vale na hora, mesmo no meio de uma rodada.
    if (!(await autonomiaLigada(db, workspaceId))) break;
    const r = await executarAcao(db, {
      workspaceId, origem: "automacao", usuarioId: null, plataforma: d.plataforma as Plataforma, entidadeId: d.campanha_id,
      entidadeNome: d.nome, acao: d.acao, valorReais: d.valorReais, confirmado: false, observacao: "Autonomia: " + d.motivo,
    });
    acoes.push({
      nome: d.nome, acao: d.acao, resultado: r.tipo,
      detalhe: r.tipo === "aguardando_aprovacao" ? r.motivo : r.tipo === "aplicada" ? d.motivo : r.erro,
    });
  }
  return { ligada: true, acoes };
}
