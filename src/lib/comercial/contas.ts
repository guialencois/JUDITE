/**
 * Contas da página Comercial (Budget & ROI). Funções puras: entram vendas e gasto, saem números.
 * Tudo vem de dados reais: vendas registradas pela equipe e gasto sincronizado das plataformas.
 * Quando falta dado para uma conta (ex.: gasto zero), o resultado é null e a tela mostra "-".
 */

export type Venda = {
  id: string;
  data: string;
  produto: string;
  pessoas: number;
  valor: number;
  origem: string | null;
  campanha_id: string | null;
  observacao: string | null;
};

export type ResumoComercial = {
  faturamento: number;
  vendas: number;
  pessoas: number;
  ticketMedio: number | null;
  /** Vendas registradas ÷ gasto em anúncios. */
  roasReal: number | null;
  /** Gasto em anúncios ÷ número de vendas. */
  cac: number | null;
};

export function resumir(vendas: Venda[], gasto: number): ResumoComercial {
  const faturamento = vendas.reduce((s, v) => s + v.valor, 0);
  const pessoas = vendas.reduce((s, v) => s + v.pessoas, 0);
  return {
    faturamento,
    vendas: vendas.length,
    pessoas,
    ticketMedio: vendas.length ? faturamento / vendas.length : null,
    roasReal: gasto > 0 ? faturamento / gasto : null,
    cac: vendas.length && gasto > 0 ? gasto / vendas.length : null,
  };
}

export type LinhaGrupo = { rotulo: string; vendas: number; pessoas: number; faturamento: number; ticketMedio: number; parte: number };

/** Agrupa as vendas (por produto, por origem...) e ordena pelo faturamento. */
export function agruparVendas(vendas: Venda[], chaveDe: (v: Venda) => string | null): LinhaGrupo[] {
  const total = vendas.reduce((s, v) => s + v.valor, 0);
  const mapa = new Map<string, { vendas: number; pessoas: number; faturamento: number }>();
  for (const v of vendas) {
    const k = (chaveDe(v) ?? "").trim() || "(não informado)";
    const g = mapa.get(k) ?? { vendas: 0, pessoas: 0, faturamento: 0 };
    g.vendas++;
    g.pessoas += v.pessoas;
    g.faturamento += v.valor;
    mapa.set(k, g);
  }
  return [...mapa.entries()]
    .map(([rotulo, g]) => ({ rotulo, ...g, ticketMedio: g.faturamento / g.vendas, parte: total > 0 ? g.faturamento / total : 0 }))
    .sort((a, b) => b.faturamento - a.faturamento);
}

export type MetricaMeta = "faturamento" | "investimento" | "compras" | "roas" | "cpa";

export const ROTULO_META: Record<MetricaMeta, string> = {
  faturamento: "Faturamento",
  investimento: "Investimento em anúncios",
  compras: "Vendas",
  roas: "ROAS real",
  cpa: "CAC (custo por venda)",
};

/** Em investimento e CAC, ficar abaixo do alvo é o bom. */
export const META_E_TETO: Record<MetricaMeta, boolean> = {
  faturamento: false, investimento: true, compras: false, roas: false, cpa: true,
};

export type Progresso = { metrica: MetricaMeta; atual: number | null; alvo: number; proporcao: number | null; atingida: boolean | null };

/** Progresso de cada meta do mês. proporcao = atual ÷ alvo (pode passar de 1). */
export function progressoDasMetas(metas: { metrica: MetricaMeta; alvo: number }[], r: ResumoComercial, gasto: number): Progresso[] {
  const atualDe: Record<MetricaMeta, number | null> = {
    faturamento: r.faturamento, investimento: gasto, compras: r.vendas, roas: r.roasReal, cpa: r.cac,
  };
  return metas.map((m) => {
    const atual = atualDe[m.metrica];
    const proporcao = atual === null || !(m.alvo > 0) ? null : atual / m.alvo;
    const atingida = proporcao === null ? null : META_E_TETO[m.metrica] ? proporcao <= 1 : proporcao >= 1;
    return { metrica: m.metrica, atual, alvo: m.alvo, proporcao, atingida };
  });
}

/** Origens sugeridas no registro de venda (a pessoa também pode escolher "Outro"). */
export const ORIGENS = [
  "WhatsApp (direto)", "Instagram", "Google (busca)", "Anúncio Meta", "Anúncio Google", "Anúncio TikTok",
  "Perfil da Empresa no Google", "Indicação", "Outro",
] as const;
