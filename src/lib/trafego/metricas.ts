/**
 * Contas do painel. Funcoes puras: entram linhas, saem numeros.
 * Nao conversam com banco nem com API, entao sao faceis de testar.
 *
 * Regra do null: null = metrica nao informada pela fonte. Soma de null com
 * numero vale o numero (quando uma plataforma informa e a outra nao);
 * null com null continua null, e a tela mostra "-".
 */

import type { LinhaMetrica } from "./tipos";

export type Totais = {
  gasto: number;
  impressoes: number;
  cliques: number;
  pageViews: number | null;
  addToCart: number | null;
  checkout: number | null;
  compras: number;
  receita: number;
};

export type Derivadas = {
  lucro: number | null;
  roas: number | null;
  cpa: number | null;
  ticket: number | null;
  margem: number | null;
  connectRate: number | null;
  ctr: number | null;
  cpc: number | null;
};

const ZERO: Totais = {
  gasto: 0, impressoes: 0, cliques: 0,
  pageViews: null, addToCart: null, checkout: null,
  compras: 0, receita: 0,
};

function somaOpcional(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export function somar(linhas: LinhaMetrica[]): Totais {
  return linhas.reduce<Totais>((t, l) => ({
    gasto: t.gasto + l.gasto,
    impressoes: t.impressoes + l.impressoes,
    cliques: t.cliques + l.cliques,
    pageViews: somaOpcional(t.pageViews, l.pageViews),
    addToCart: somaOpcional(t.addToCart, l.addToCart),
    checkout: somaOpcional(t.checkout, l.checkout),
    compras: t.compras + l.compras,
    receita: t.receita + l.receita,
  }), { ...ZERO });
}

/**
 * custosPercent = quanto do faturamento vai embora em custo do produto,
 * taxa de gateway, imposto. O painel usa 25% como padrao.
 */
export function derivar(t: Totais, custosPercent = 25): Derivadas {
  const lucro = t.receita * (1 - custosPercent / 100) - t.gasto;
  return {
    lucro: t.receita || t.gasto ? lucro : null,
    roas: t.gasto > 0 ? t.receita / t.gasto : null,
    cpa: t.compras > 0 ? t.gasto / t.compras : null,
    ticket: t.compras > 0 ? t.receita / t.compras : null,
    margem: t.receita > 0 ? lucro / t.receita : null,
    connectRate: t.pageViews !== null && t.cliques > 0 ? t.pageViews / t.cliques : null,
    ctr: t.impressoes > 0 ? t.cliques / t.impressoes : null,
    cpc: t.cliques > 0 ? t.gasto / t.cliques : null,
  };
}

/**
 * Variacao contra o periodo anterior, de -1 a +N (0,15 = subiu 15%).
 * Usa o modulo do anterior no divisor para que sair de -40 para 0 de lucro
 * apareca como melhora, e nao como queda.
 */
export function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  return (atual - anterior) / Math.abs(anterior);
}

export type DiaAgregado = { data: string; totais: Totais; derivadas: Derivadas };

/** Serie diaria continua: dias sem veiculacao entram zerados, sem buraco no grafico. */
export function porDia(linhas: LinhaMetrica[], de: string, ate: string, custosPercent = 25): DiaAgregado[] {
  const porData = new Map<string, LinhaMetrica[]>();
  for (const l of linhas) {
    const lista = porData.get(l.data);
    if (lista) lista.push(l);
    else porData.set(l.data, [l]);
  }
  const dias: DiaAgregado[] = [];
  const cursor = new Date(de + "T12:00:00");
  const fim = new Date(ate + "T12:00:00");
  while (cursor <= fim) {
    const data = cursor.toISOString().slice(0, 10);
    const totais = somar(porData.get(data) ?? []);
    dias.push({ data, totais, derivadas: derivar(totais, custosPercent) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

export type ItemRanking = {
  chave: string;
  plataforma: string;
  nome: string;
  totais: Totais;
  derivadas: Derivadas;
};

/**
 * Agrupa por anuncio. Quando a plataforma nao expoe anuncio (campanha Smart
 * ou Performance Max do Google), cai para o nome da campanha.
 */
export function agruparPorAnuncio(linhas: LinhaMetrica[], custosPercent = 25): ItemRanking[] {
  const grupos = new Map<string, { plataforma: string; nome: string; linhas: LinhaMetrica[] }>();
  for (const l of linhas) {
    const nome = l.anuncio || l.campanha || "(sem nome)";
    const chave = l.plataforma + "|" + (l.anuncioId || l.campanhaId || nome);
    const g = grupos.get(chave);
    if (g) g.linhas.push(l);
    else grupos.set(chave, { plataforma: l.plataforma, nome, linhas: [l] });
  }
  return [...grupos.entries()].map(([chave, g]) => {
    const totais = somar(g.linhas);
    return { chave, plataforma: g.plataforma, nome: g.nome, totais, derivadas: derivar(totais, custosPercent) };
  });
}

export type EtapaFunil = { etapa: string; valor: number | null; conversao: number | null };

export function funil(t: Totais): EtapaFunil[] {
  const etapas: { etapa: string; valor: number | null }[] = [
    { etapa: "Impressoes", valor: t.impressoes },
    { etapa: "Cliques", valor: t.cliques },
    { etapa: "Page views", valor: t.pageViews },
    { etapa: "Add to cart", valor: t.addToCart },
    { etapa: "Inicio de checkout", valor: t.checkout },
    { etapa: "Compras", valor: t.compras },
  ];
  return etapas.map((e, i) => {
    const anterior = i > 0 ? etapas[i - 1].valor : null;
    const conversao = i > 0 && e.valor !== null && anterior !== null && anterior > 0 ? e.valor / anterior : null;
    return { ...e, conversao };
  });
}

// ----- formatos em portugues, usados nas telas -----

export const brl = (v: number | null): string =>
  v === null ? "-" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const inteiro = (v: number | null): string =>
  v === null ? "-" : Math.round(v).toLocaleString("pt-BR");

export const percent = (v: number | null, casas = 1): string =>
  v === null ? "-" : (v * 100).toFixed(casas).replace(".", ",") + "%";

export const multiplicador = (v: number | null): string =>
  v === null ? "-" : v.toFixed(2).replace(".", ",") + "x";

export const dataCurta = (iso: string): string => {
  const [, m, d] = iso.split("-");
  return d + "/" + m;
};
