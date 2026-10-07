/**
 * Agente Financeiro da CMO. É código, não IA: o orçamento de uma campanha nova sai de uma conta
 * feita com os Limites da IA e o gasto real do mês. A IA recebe o teto pronto e não pode passar dele.
 * Funções puras (testes em financeiro.test.ts).
 */

import type { SituacaoDoMes } from "@/lib/trafego/limites";
import { TETO_ABSOLUTO_REAIS } from "@/lib/trafego/limites";

/** Menor orçamento diário que vale a pena propor (abaixo disso as plataformas quase não entregam). */
export const ORCAMENTO_MINIMO_REAIS = 10;
/** Campanha nova começa conservadora: no máximo esta fração do teto diário sem aprovação. */
export const FRACAO_INICIAL = 0.3;
/** E usa no máximo esta fração da folga que sobra no mês. */
export const FRACAO_DA_FOLGA = 0.5;

export type Orcamento = {
  /** Valor recomendado por dia. 0 quando não cabe campanha nova no mês. */
  recomendado: number;
  /** Maior valor que a proposta pode ter sem estourar o mês nem o teto diário. */
  teto: number;
  /** Como a conta foi feita, para a tela mostrar. */
  explicacao: string;
};

const arred5 = (v: number) => Math.floor(v / 5) * 5;
const reais = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");

export function orcamentoInicial(e: { maxSemAprovacao: number; mes: SituacaoDoMes; canal?: SituacaoDoMes | null }): Orcamento {
  const folgaDe = (m: SituacaoDoMes) =>
    m.mensalMax > 0 && m.diasRestantes > 0 ? (m.mensalMax - m.gastoNoMes) / m.diasRestantes - m.outrasCampanhasPorDia : Number.POSITIVE_INFINITY;
  const folga = Math.min(folgaDe(e.mes), e.canal ? folgaDe(e.canal) : Number.POSITIVE_INFINITY);
  const tetoDiario = Math.min(e.maxSemAprovacao, TETO_ABSOLUTO_REAIS);
  const teto = Math.max(0, Math.floor(Math.min(tetoDiario, folga)));

  if (teto < ORCAMENTO_MINIMO_REAIS) {
    return {
      recomendado: 0, teto,
      explicacao: `Não cabe campanha nova neste mês: a folga é de ${reais(Math.max(0, folga))} por dia, abaixo do mínimo de ${reais(ORCAMENTO_MINIMO_REAIS)}.`,
    };
  }
  const conservador = Math.min(tetoDiario * FRACAO_INICIAL, Number.isFinite(folga) ? folga * FRACAO_DA_FOLGA : Number.POSITIVE_INFINITY);
  const recomendado = Math.min(teto, Math.max(ORCAMENTO_MINIMO_REAIS, arred5(conservador)));
  return {
    recomendado, teto,
    explicacao: `Começo conservador de ${reais(recomendado)} por dia (campanha nova passa por aprendizado). ` +
      `Teto: ${reais(teto)} por dia, pelo limite diário de ${reais(e.maxSemAprovacao)}` +
      (Number.isFinite(folga) ? ` e pela folga do mês de ${reais(folga)} por dia.` : "."),
  };
}

/** Confere um orçamento pedido por uma pessoa. Devolve o motivo quando é inválido. */
export function orcamentoInvalido(valor: number): string | null {
  if (!Number.isFinite(valor) || valor <= 0) return "O orçamento precisa ser um valor maior que zero.";
  if (valor > TETO_ABSOLUTO_REAIS) return `O orçamento passa do teto de segurança de R$ ${TETO_ABSOLUTO_REAIS} por dia.`;
  return null;
}
