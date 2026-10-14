/**
 * Regras de prudência do Diretor. A IA recebe estas regras no pedido, mas o código confere de novo:
 * recomendação que não cumpre a regra é descartada (com o motivo) antes de chegar à tela.
 *
 *  - Volume mínimo: nada de mexer em verba com poucos dados.
 *  - Período de aprendizado: a campanha precisa ter entregue por alguns dias.
 *  - Nada inventado: recomendação de verba só vale para campanha que existe no resumo.
 *
 * Funções puras. Testes em regras.test.ts.
 */

import { TETO_ABSOLUTO_REAIS } from "@/lib/trafego/limites";
import { TIPOS_DE_VERBA, type CampanhaResumo, type RecomendacaoIA, type ResumoDiretor } from "./tipos";

/** Dias com entrega antes de qualquer mudança (período de aprendizado das plataformas). */
export const DIAS_MINIMOS = 7;
/** Cliques mínimos na janela para julgar uma campanha. */
export const CLIQUES_MINIMOS = 100;
/** Conversões mínimas na janela para recomendar AUMENTO de verba. */
export const CONVERSOES_MINIMAS = 5;

export type Descartada = { titulo: string; motivo: string };

function campanhaDe(resumo: ResumoDiretor, r: RecomendacaoIA): CampanhaResumo | undefined {
  return resumo.campanhas.find((c) => c.campanha_id === r.campanha_id && (!r.plataforma || c.plataforma === r.plataforma));
}

/** Devolve o motivo do descarte, ou null quando a recomendação pode ir para a tela. */
export function motivoDoDescarte(r: RecomendacaoIA, resumo: ResumoDiretor): string | null {
  if (!r.titulo.trim() || !r.justificativa.trim()) return "veio sem título ou sem justificativa";
  if (!TIPOS_DE_VERBA.includes(r.tipo)) return null;

  if (!r.campanha_id) return "mexe em verba mas não diz qual campanha";
  const c = campanhaDe(resumo, r);
  if (!c) return "cita uma campanha que não existe nos dados sincronizados";

  if (r.tipo === "pausar_campanha") {
    if (!c.ativa) return "a campanha já está pausada";
    if (c.dias_com_dados < DIAS_MINIMOS) return `a campanha tem só ${c.dias_com_dados} dia(s) de dados (mínimo ${DIAS_MINIMOS}: período de aprendizado)`;
    if (c.cliques < CLIQUES_MINIMOS) return `a campanha tem só ${c.cliques} cliques (mínimo ${CLIQUES_MINIMOS}) para justificar uma pausa`;
    return null;
  }

  if (r.tipo === "ativar_campanha") {
    if (c.ativa) return "a campanha já está ativa";
    return null;
  }

  // ajustar_orcamento
  if (r.valor_sugerido === null || !(r.valor_sugerido > 0)) return "sugere ajuste de orçamento sem informar o novo valor";
  if (r.valor_sugerido > TETO_ABSOLUTO_REAIS) return "sugere um orçamento acima do teto absoluto de segurança";
  if (c.orcamento_diario === null) return "o orçamento atual da campanha é desconhecido";
  if (c.dias_com_dados < DIAS_MINIMOS) return `a campanha tem só ${c.dias_com_dados} dia(s) de dados (mínimo ${DIAS_MINIMOS}: período de aprendizado)`;
  if (c.cliques < CLIQUES_MINIMOS) return `a campanha tem só ${c.cliques} cliques (mínimo ${CLIQUES_MINIMOS}) para mudar a verba`;
  if (Math.abs(r.valor_sugerido - c.orcamento_diario) < 0.01) return "o valor sugerido é igual ao orçamento atual";
  if (r.valor_sugerido > c.orcamento_diario && c.compras < CONVERSOES_MINIMAS) {
    return `aumento de verba exige pelo menos ${CONVERSOES_MINIMAS} conversões na janela (a campanha tem ${c.compras})`;
  }
  return null;
}

export function aplicarRegras(recomendacoes: RecomendacaoIA[], resumo: ResumoDiretor): { aceitas: RecomendacaoIA[]; descartadas: Descartada[] } {
  const aceitas: RecomendacaoIA[] = [];
  const descartadas: Descartada[] = [];
  for (const r of recomendacoes) {
    const motivo = motivoDoDescarte(r, resumo);
    if (motivo) {
      descartadas.push({ titulo: r.titulo.slice(0, 200), motivo });
      continue;
    }
    // Fora das recomendações de verba, campanha e valor não fazem sentido: limpa para não confundir a tela.
    aceitas.push(TIPOS_DE_VERBA.includes(r.tipo)
      ? { ...r, plataforma: (campanhaDe(resumo, r)?.plataforma ?? r.plataforma) as RecomendacaoIA["plataforma"] }
      : { ...r, valor_sugerido: null });
  }
  return { aceitas, descartadas };
}
