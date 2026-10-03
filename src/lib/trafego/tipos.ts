/**
 * Tipos do painel de tráfego, independentes de quem fornece os dados.
 * Hoje quem fornece é o Windsor (temporário); depois será o LUNIKO.
 *
 * Regra do painel inteiro:
 *   null = a plataforma NÃO informa essa métrica (ex.: page view no Google Ads)
 *   0    = a plataforma informa e o valor é zero
 */

export type Plataforma = "google_ads" | "facebook";

export const PLATAFORMAS: Plataforma[] = ["google_ads", "facebook"];

export const NOME_PLATAFORMA: Record<Plataforma, string> = {
  google_ads: "Google Ads",
  facebook: "Meta Ads",
};

export type LinhaMetrica = {
  data: string;
  plataforma: Plataforma;
  contaExterna: string;
  campanhaId: string;
  campanha: string;
  anuncioId: string;
  anuncio: string;
  gasto: number;
  impressoes: number;
  cliques: number;
  pageViews: number | null;
  addToCart: number | null;
  checkout: number | null;
  compras: number;
  receita: number;
};

export type LinhaCampanha = {
  plataforma: Plataforma;
  campanhaId: string;
  contaExterna: string;
  nome: string;
  status: string | null;
  orcamentoDiario: number | null;
  moeda: string;
};

export type TipoEntidade = "campanha" | "conjunto" | "anuncio";

/** Uma mudança de verdade na conta de anúncios, descrita sem depender do fornecedor. */
export type AcaoAnuncio =
  | { tipo: "pausar" | "ativar"; plataforma: Plataforma; conta: string; entidade: TipoEntidade; entidadeId: string }
  | { tipo: "definir_orcamento"; plataforma: Plataforma; conta: string; campanhaId: string; valorReais: number };

/** Converte uma linha da tabela trafego_metricas_dia para o formato do painel. */
export function metricaDoBanco(r: Record<string, unknown>): LinhaMetrica {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    data: String(r.data),
    plataforma: r.plataforma as Plataforma,
    contaExterna: String(r.conta_externa ?? ""),
    campanhaId: String(r.campanha_id ?? ""),
    campanha: String(r.campanha ?? ""),
    anuncioId: String(r.anuncio_id ?? ""),
    anuncio: String(r.anuncio ?? ""),
    gasto: Number(r.gasto ?? 0),
    impressoes: Number(r.impressoes ?? 0),
    cliques: Number(r.cliques ?? 0),
    pageViews: n(r.page_views),
    addToCart: n(r.add_to_cart),
    checkout: n(r.checkout),
    compras: Number(r.compras ?? 0),
    receita: Number(r.receita ?? 0),
  };
}

/** Data AAAA-MM-DD deslocada em dias a partir de hoje (UTC). */
export function dia(deslocamento: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + deslocamento);
  return d.toISOString().slice(0, 10);
}
