/**
 * Freios do painel. Toda mudanca de orcamento passa por aqui antes de sair
 * para a plataforma. Os limites ficam na tabela trafego_config e podem ser
 * mudados dentro da JUDITE (tela Limites da IA):
 *   orcamento_max_sem_aprovacao  teto diario por campanha que nao pede aprovacao
 *   aumento_max_por_vez_percent  maior aumento de uma vez
 *   orcamento_mensal_max         teto de gasto do workspace no mes (todas as plataformas)
 *
 * Funcoes puras: nao falam com banco nem com API. Testes em limites.test.ts.
 */

export type Checagem = {
  ok: boolean;
  precisaAprovacao: boolean;
  motivo?: string;
  valorFinal: number;
};

/** Teto absoluto de seguranca: nenhuma acao automatica passa disso. */
export const TETO_ABSOLUTO_REAIS = 5000;

/** Padroes usados quando o workspace ainda nao tem o valor gravado. */
export const PADRAO_MAX_SEM_APROVACAO = 100;
export const PADRAO_AUMENTO_PERCENT = 10;
export const PADRAO_MENSAL_MAX = 2000;

/** Retrato do mes para o freio mensal. */
export type SituacaoDoMes = {
  /** Quanto ja foi gasto no mes, somando todas as plataformas. */
  gastoNoMes: number;
  /** Soma dos orcamentos diarios das OUTRAS campanhas ligadas (sem a que esta sendo mudada). */
  outrasCampanhasPorDia: number;
  /** Dias que faltam no mes, contando hoje. */
  diasRestantes: number;
  /** Teto do mes (orcamento_mensal_max). */
  mensalMax: number;
};

export type EntradaOrcamento = {
  atualReais: number | null;
  novoReais: number;
  maxSemAprovacao: number;
  aumentoMaxPercent?: number;
  /** Quando informado, o freio mensal tambem e conferido. */
  mes?: SituacaoDoMes;
};

const reais = (v: number) => "R$ " + (Math.round(v * 100) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Quanto o workspace gastaria ate o fim do mes se esta campanha passar a gastar
 * "novoPorDia": o que ja gastou + (as outras campanhas ligadas + esta) x dias que faltam.
 */
export function projecaoDoMes(mes: SituacaoDoMes, novoPorDia: number): number {
  const porDia = Math.max(0, mes.outrasCampanhasPorDia) + Math.max(0, novoPorDia);
  return Math.max(0, mes.gastoNoMes) + porDia * Math.max(0, mes.diasRestantes);
}

/** Devolve o motivo quando a mudanca faria o gasto do mes passar do teto; null quando cabe. */
export function estouroMensal(mes: SituacaoDoMes, novoPorDia: number): string | null {
  if (!(mes.mensalMax > 0)) return null;
  const projecao = projecaoDoMes(mes, novoPorDia);
  if (projecao <= mes.mensalMax) return null;
  return "Com essa mudanca o gasto do mes chegaria a cerca de " + reais(projecao) +
    ", acima do orcamento mensal de " + reais(mes.mensalMax) + " (ja gasto: " + reais(mes.gastoNoMes) + ").";
}

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
  const limitePercent = e.aumentoMaxPercent ?? PADRAO_AUMENTO_PERCENT;
  // Sem saber o orçamento atual não dá para medir o aumento: pede confirmação humana.
  if (e.atualReais === null || !(e.atualReais > 0)) {
    return { ok: true, precisaAprovacao: true, valorFinal: novo,
      motivo: "O orçamento atual desta campanha é desconhecido; sincronize os dados ou confirme o novo valor." };
  }
  // Pequena folga (meio centavo) para o arredondamento nao barrar um aumento exatamente no limite.
  if (novo > e.atualReais * (1 + limitePercent / 100) + 0.005) {
    return { ok: true, precisaAprovacao: true, valorFinal: novo,
      motivo: "Aumento maior que " + limitePercent + "% de uma vez." };
  }
  // Freio mensal: so vale para aumento. Reduzir verba nunca e barrado por causa do mes.
  if (e.mes && novo > e.atualReais) {
    const motivo = estouroMensal(e.mes, novo);
    if (motivo) return { ok: true, precisaAprovacao: true, valorFinal: novo, motivo };
  }
  return { ok: true, precisaAprovacao: false, valorFinal: novo };
}

/**
 * Ligar uma campanha tambem gasta dinheiro: confere o teto do mes com o orcamento diario dela.
 * Pausar nunca passa por aqui (pausar e sempre permitido).
 */
export function validarAtivacao(orcamentoDiario: number | null, mes: SituacaoDoMes): { precisaAprovacao: boolean; motivo?: string } {
  if (orcamentoDiario === null || !(orcamentoDiario > 0)) {
    // Sem saber quanto a campanha gasta por dia, so da para barrar se o mes ja estourou.
    if (mes.mensalMax > 0 && mes.gastoNoMes >= mes.mensalMax) {
      return { precisaAprovacao: true, motivo: "O orcamento mensal de " + reais(mes.mensalMax) + " ja foi atingido (gasto: " + reais(mes.gastoNoMes) + ")." };
    }
    return { precisaAprovacao: false };
  }
  const motivo = estouroMensal(mes, orcamentoDiario);
  return motivo ? { precisaAprovacao: true, motivo } : { precisaAprovacao: false };
}
