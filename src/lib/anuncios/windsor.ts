/**
 * Provedor TEMPORÁRIO de anúncios: Windsor.ai (leitura e ações).
 * Fica isolado aqui para ser trocado pelo LUNIKO sem mexer no resto da JUDITE.
 *
 * Documentação: https://windsor.ai/api-documentation/
 * Roda SOMENTE no servidor: a chave WINDSOR_API_KEY nunca vai para o navegador.
 */

import type { AcaoAnuncio, LinhaCampanha, LinhaMetrica, Plataforma } from "@/lib/trafego/tipos";
import type { Periodo, ProvedorAnuncios } from "./provedor";

const BASE = "https://connectors.windsor.ai";
const TEMPO_LIMITE_MS = 60000;

function chave(): string {
  const k = process.env.WINDSOR_API_KEY;
  if (!k) throw new Error("WINDSOR_API_KEY não está definida (.env.local e Vercel).");
  return k;
}

async function pedir(url: string, init?: RequestInit): Promise<unknown> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetch(url, { ...init, signal: controle.signal, cache: "no-store" });
    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    if (!resposta.ok) {
      // Nunca repassa a URL (ela contém a chave); só o status e um trecho da resposta.
      throw new Error("Windsor respondeu " + resposta.status + ": " + texto.slice(0, 200));
    }
    return json;
  } catch (erro) {
    if (erro instanceof Error && erro.name === "AbortError") {
      throw new Error("O Windsor demorou mais de 60s para responder.");
    }
    throw erro;
  } finally {
    clearTimeout(relogio);
  }
}

function linhasDe(json: unknown): Record<string, unknown>[] {
  const j = json as { data?: unknown; result?: unknown } | null;
  const linhas = j?.data ?? j?.result ?? json;
  return Array.isArray(linhas) ? (linhas as Record<string, unknown>[]) : [];
}

async function lerDados(p: Periodo, campos: string[]): Promise<Record<string, unknown>[]> {
  const busca = new URLSearchParams({
    api_key: chave(),
    fields: campos.join(","),
    date_from: p.de,
    date_to: p.ate,
    _renderer: "json",
  });
  if (p.contas.length) busca.set("select_accounts", p.contas.join(","));
  return linhasDe(await pedir(BASE + "/" + p.plataforma + "?" + busca.toString()));
}

// ---------------------------------------------------------------------
// Campos pedidos e tradução (nomes confirmados no Google; Meta pela documentação)
// ---------------------------------------------------------------------

const CAMPOS_DIA: Record<Plataforma, string[]> = {
  google_ads: ["date", "account_id", "campaign", "campaign_id", "spend", "impressions", "clicks", "conversions", "conversion_value"],
  facebook: [
    "date", "account_id", "campaign", "campaign_id", "ad_id", "ad_name", "spend", "impressions", "clicks",
    "actions_link_click", "actions_landing_page_view", "actions_add_to_cart", "actions_initiate_checkout",
    "actions_offsite_conversion_fb_pixel_purchase", "action_values_offsite_conversion_fb_pixel_purchase",
  ],
};

const CAMPOS_CAMPANHA: Record<Plataforma, string[]> = {
  google_ads: ["account_id", "campaign", "campaign_id", "campaign_status", "budget_amount", "account_currency_code"],
  facebook: ["account_id", "campaign", "campaign_id", "campaign_status", "daily_budget"],
};

/** Para cada métrica, os nomes aceitos (do melhor para o pior). Lista vazia = a plataforma não informa. */
const MAPA: Record<Plataforma, Record<string, string[]>> = {
  google_ads: {
    gasto: ["spend", "cost"], impressoes: ["impressions"], cliques: ["clicks"],
    pageViews: [], addToCart: [], checkout: [],
    compras: ["conversions"], receita: ["conversion_value"],
  },
  facebook: {
    gasto: ["spend"], impressoes: ["impressions"], cliques: ["actions_link_click", "clicks"],
    pageViews: ["actions_landing_page_view"],
    addToCart: ["actions_add_to_cart", "actions_onsite_web_add_to_cart"],
    checkout: ["actions_initiate_checkout", "actions_onsite_web_initiate_checkout"],
    compras: ["actions_offsite_conversion_fb_pixel_purchase", "actions_purchase", "purchases"],
    receita: ["action_values_offsite_conversion_fb_pixel_purchase", "action_values_purchase", "total_revenue"],
  },
};

function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function pegar(linha: Record<string, unknown>, candidatos: string[]): number | null {
  for (const campo of candidatos) {
    const n = numero(linha[campo]);
    if (n !== null) return n;
  }
  return null;
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function normalizarMetrica(plataforma: Plataforma, linha: Record<string, unknown>): LinhaMetrica | null {
  const data = texto(linha.date).slice(0, 10);
  if (!data) return null;
  const mapa = MAPA[plataforma];
  const opcional = (k: string) => (mapa[k].length ? pegar(linha, mapa[k]) ?? 0 : null);
  return {
    data,
    plataforma,
    contaExterna: texto(linha.account_id),
    campanhaId: texto(linha.campaign_id),
    campanha: texto(linha.campaign),
    anuncioId: texto(linha.ad_id),
    anuncio: texto(linha.ad_name),
    gasto: pegar(linha, mapa.gasto) ?? 0,
    impressoes: pegar(linha, mapa.impressoes) ?? 0,
    cliques: pegar(linha, mapa.cliques) ?? 0,
    pageViews: opcional("pageViews"),
    addToCart: opcional("addToCart"),
    checkout: opcional("checkout"),
    compras: pegar(linha, mapa.compras) ?? 0,
    receita: pegar(linha, mapa.receita) ?? 0,
  };
}

function normalizarCampanha(plataforma: Plataforma, linha: Record<string, unknown>): LinhaCampanha | null {
  const campanhaId = texto(linha.campaign_id);
  if (!campanhaId) return null;
  // Meta devolve o orçamento diário em centavos; Google já devolve em reais.
  const bruto = plataforma === "facebook" ? numero(linha.daily_budget) : numero(linha.budget_amount);
  return {
    plataforma,
    campanhaId,
    contaExterna: texto(linha.account_id),
    nome: texto(linha.campaign),
    status: texto(linha.campaign_status) || null,
    orcamentoDiario: bruto === null ? null : plataforma === "facebook" ? bruto / 100 : bruto,
    moeda: texto(linha.account_currency_code) || "BRL",
  };
}

// ---------------------------------------------------------------------
// Ações (o Windsor usa nomes e unidades diferentes por plataforma)
// ---------------------------------------------------------------------

function traduzirAcao(a: AcaoAnuncio): { action: string; params: Record<string, unknown> } {
  if (a.tipo === "definir_orcamento") {
    return a.plataforma === "google_ads"
      ? { action: "set_campaign_budget", params: { campaign_id: a.campanhaId, budget_type: "daily", amount_micros: Math.round(a.valorReais * 1_000_000) } }
      : { action: "set_campaign_budget", params: { campaign_id: a.campanhaId, budget_type: "daily", amount: Math.round(a.valorReais * 100) } };
  }
  const prefixo = a.tipo === "ativar" ? "enable" : "pause";
  if (a.entidade === "campanha") return { action: prefixo + "_campaign", params: { campaign_id: a.entidadeId } };
  if (a.entidade === "anuncio") return { action: prefixo + "_ad", params: { ad_id: a.entidadeId } };
  return a.plataforma === "google_ads"
    ? { action: prefixo + "_ad_group", params: { ad_group_id: a.entidadeId } }
    : { action: prefixo + "_adset", params: { adset_id: a.entidadeId } };
}

export const provedorWindsor: ProvedorAnuncios = {
  nome: "Windsor.ai (temporário)",

  async lerMetricas(p) {
    const cruas = await lerDados(p, CAMPOS_DIA[p.plataforma]);
    return cruas.map((l) => normalizarMetrica(p.plataforma, l)).filter((l): l is LinhaMetrica => l !== null);
  },

  async lerCampanhas(p) {
    const cruas = await lerDados(p, CAMPOS_CAMPANHA[p.plataforma]);
    const vistas = new Map<string, LinhaCampanha>();
    for (const c of cruas) {
      const n = normalizarCampanha(p.plataforma, c);
      if (n) vistas.set(n.campanhaId, n);
    }
    return [...vistas.values()];
  },

  async executar(acao) {
    const { action, params } = traduzirAcao(acao);
    return pedir(BASE + "/" + acao.plataforma + "/actions?api_key=" + encodeURIComponent(chave()), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: acao.conta, action, params }),
    });
  },
};
