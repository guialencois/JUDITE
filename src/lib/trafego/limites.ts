/**
 * Freios do painel. Toda mudanca de orcamento passa por aqui antes de sair
 * para a plataforma. O teto sem aprovacao fica na tabela trafego_config
 * (chave orcamento_max_sem_aprovacao) e pode ser mudado dentro da JUDITE.
 */

export type Checagem = {
  ok: boolean;
  precisaAprovacao: boolean;
  motivo?: string;
  valorFinal: number;
};

/** Teto absoluto de seguranca: nenhuma acao automatica passa disso. */
export const TETO_ABSOLUTO_REAIS = 5000;

export type EntradaOrcamento = {
  atualReais: number | null;
  novoReais: number;
  maxSemAprovacao: number;
  aumentoMaxPercent?: number;
};

export function validarOrcamento(e: EntradaOrcamento): Checagem {
  const novo = Math.round(e.novoReais * 100) / 100;
  const base = { ok: false, precisaAprovacao: false, valorFinal: novo };

  if (!Number.isFinite(novo) || novo <= 0) {
    return { ...base, motivo: "O orcamento precisa ser um valor maior que zero." };
  }
  if (novo > TETO_ABSOLUTO_REAIS) {
    return { ...base, motivo: "Acima do teto de seguranca de R$ " + TETO_ABSOLUTO_REAIS + " por dia." };
  }
  if (novo > e.maxSemAprovacao) {
    return { ok: true, precisaAprovacao: true, valorFinal: novo,
      motivo: "Acima do teto de R$ " + e.maxSemAprovacao + " por dia que a JUDITE muda sozinha." };
  }
  const limitePercent = e.aumentoMaxPercent ?? 50;
  if (e.atualReais && e.atualReais > 0 && novo > e.atualReais * (1 + limitePercent / 100)) {
    return { ok: true, precisaAprovacao: true, valorFinal: novo,
      motivo: "Aumento maior que " + limitePercent + "% de uma vez." };
  }
  return { ok: true, precisaAprovacao: false, valorFinal: novo };
}
