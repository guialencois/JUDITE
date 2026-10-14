/**
 * Provedor de anúncios pela Windsor.ai, escolhido por workspace na página Conexões
 * (alternativa às conexões nativas por OAuth, que continuam sendo o padrão).
 *
 * Leitura: API REST da Windsor (src/lib/windsor/api.ts). Nomes de campos conferidos em 07/10/2026 em
 *          https://connectors.windsor.ai/{conector}/fields
 * Escrita: servidor MCP da Windsor com a chave de API (src/lib/windsor/mcp.ts), ferramenta execute_action.
 *          Ações e parâmetros conferidos em 07/10/2026 pela ferramenta list_actions:
 *            facebook   pause_campaign | enable_campaign {campaign_id} · pause_adset | enable_adset {adset_id}
 *                       pause_ad | enable_ad {ad_id} · set_campaign_budget {campaign_id, budget_type, amount em centavos}
 *                       create_campaign {name, objective, special_ad_categories, daily_budget em centavos, status}
 *            google_ads pause_campaign | enable_campaign {campaign_id} · pause_ad_group | enable_ad_group {ad_group_id}
 *                       set_campaign_budget {campaign_id, budget_type, amount_micros}
 *            tiktok     pause_* | enable_* de campaign, ad_group e ad · set_campaign_budget {campaign_id, amount inteiro}
 *
 * As contas ficam gravadas na JUDITE no mesmo formato dos provedores nativos (contaCanonica), então
 * trocar a fonte de uma plataforma não duplica métricas. Para falar com a Windsor usa-se o ID dela.
 *
 * Roda SOMENTE no servidor. executar() e criarCampanhaPausada() só são chamados depois dos freios de
 * src/lib/trafego/limites.ts e executar.ts (ou da aprovação do dono, no Campaign Manager).
 */

import type { AcaoAnuncio, LinhaCampanha, LinhaMetrica, Plataforma } from "@/lib/trafego/tipos";
import { lerWindsor, semChave, type LinhaWindsor } from "@/lib/windsor/api";
import { contaCanonica, contaWindsorDe, type ContaWindsor } from "@/lib/windsor/conexao";
import { chamarWindsor, type ChamarWindsor } from "@/lib/windsor/mcp";
import { ErroProvedor, numero, texto } from "./http";
import type { NovaCampanha, Periodo, ProvedorAnuncios } from "./provedor";

/** Moedas sem centavos: nelas a Meta informa o orçamento em unidades inteiras, não em centésimos. */
const MOEDAS_SEM_CENTAVOS = ["CLP", "COP", "CRC", "HUF", "IDR", "ISK", "JPY", "KRW", "PYG", "TWD", "VND"];

const CAMPOS_METRICAS: Record<Plataforma, string[]> = {
  // Por campanha, como no provedor nativo: Performance Max e campanhas inteligentes não expõem anúncio.
  google_ads: ["date", "account_id", "campaign", "campaign_id", "spend", "impressions", "clicks", "conversions", "conversion_value"],
  facebook: [
    "date", "account_id", "campaign", "campaign_id", "ad_id", "ad_name", "spend", "impressions", "clicks",
    "actions_link_click", "actions_landing_page_view",
    "actions_offsite_conversion_fb_pixel_add_to_cart", "actions_add_to_cart",
    "actions_offsite_conversion_fb_pixel_initiate_checkout", "actions_initiate_checkout",
    "actions_offsite_conversion_fb_pixel_purchase", "actions_purchase", "actions_omni_purchase",
    "action_values_offsite_conversion_fb_pixel_purchase", "action_values_purchase", "action_values_omni_purchase",
  ],
  tiktok: ["date", "account_id", "campaign", "campaign_id", "ad_id", "ad_name", "spend", "impressions", "clicks", "conversions"],
};

// A data vai junto para pegar só a linha mais recente de cada campanha (sem ela, a Windsor soma os dias).
const CAMPOS_CAMPANHAS: Record<Plataforma, string[]> = {
  google_ads: ["date", "account_id", "campaign", "campaign_id", "campaign_status", "budget_amount", "account_currency_code"],
  facebook: ["date", "account_id", "campaign", "campaign_id", "campaign_configured_status", "campaign_daily_budget", "account_currency"],
  tiktok: ["date", "account_id", "campaign", "campaign_id", "campaign_operation_status", "campaign_budget", "campaign_budget_mode", "currency"],
};

const STATUS: Record<Plataforma, { ativa: string; pausada: string }> = {
  google_ads: { ativa: "ENABLED", pausada: "PAUSED" },
  facebook: { ativa: "ACTIVE", pausada: "PAUSED" },
  tiktok: { ativa: "ENABLE", pausada: "DISABLE" },
};

/**
 * A Meta repete a mesma compra em vários tipos (pixel, purchase, omni). Os campos vêm por ordem de
 * preferência e só o PRIMEIRO com valor conta, igual ao provedor nativo.
 */
function primeiroComValor(linha: LinhaWindsor, campos: string[]): number {
  for (const campo of campos) {
    const n = numero(linha[campo]);
    if (n !== null && n > 0) return n;
  }
  return 0;
}

/** Converte uma linha diária da Windsor para o formato do painel. Valores já vêm na moeda da conta (reais). */
export function metricaDaWindsor(plataforma: Plataforma, linha: LinhaWindsor): LinhaMetrica | null {
  const data = texto(linha.date).slice(0, 10);
  const campanhaId = texto(linha.campaign_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !campanhaId) return null;
  const base = {
    data,
    plataforma,
    contaExterna: contaCanonica(plataforma, texto(linha.account_id)),
    campanhaId,
    campanha: texto(linha.campaign),
    gasto: numero(linha.spend) ?? 0,
    impressoes: numero(linha.impressions) ?? 0,
  };
  if (plataforma === "facebook") {
    return {
      ...base,
      anuncioId: texto(linha.ad_id),
      anuncio: texto(linha.ad_name),
      // Clique no link é o que leva ao site; "clicks" inclui curtidas e cliques no perfil.
      cliques: numero(linha.actions_link_click) ?? numero(linha.clicks) ?? 0,
      pageViews: numero(linha.actions_landing_page_view) ?? 0,
      addToCart: primeiroComValor(linha, ["actions_offsite_conversion_fb_pixel_add_to_cart", "actions_add_to_cart"]),
      checkout: primeiroComValor(linha, ["actions_offsite_conversion_fb_pixel_initiate_checkout", "actions_initiate_checkout"]),
      compras: primeiroComValor(linha, ["actions_offsite_conversion_fb_pixel_purchase", "actions_purchase", "actions_omni_purchase"]),
      receita: primeiroComValor(linha, ["action_values_offsite_conversion_fb_pixel_purchase", "action_values_purchase", "action_values_omni_purchase"]),
    };
  }
  if (plataforma === "google_ads") {
    return {
      ...base, anuncioId: "", anuncio: "", cliques: numero(linha.clicks) ?? 0,
      pageViews: null, addToCart: null, checkout: null,
      compras: numero(linha.conversions) ?? 0, receita: numero(linha.conversion_value) ?? 0,
    };
  }
  // TikTok: igual ao provedor nativo. O valor das compras não é lido; o faturamento real vem da página Comercial.
  return {
    ...base, anuncioId: texto(linha.ad_id), anuncio: texto(linha.ad_name), cliques: numero(linha.clicks) ?? 0,
    pageViews: null, addToCart: null, checkout: null,
    compras: numero(linha.conversions) ?? 0, receita: 0,
  };
}

/** Converte uma linha de campanha da Windsor. O orçamento diário sai sempre em reais (moeda da conta). */
export function campanhaDaWindsor(plataforma: Plataforma, linha: LinhaWindsor): LinhaCampanha | null {
  const campanhaId = texto(linha.campaign_id);
  if (!campanhaId) return null;
  const base = { plataforma, campanhaId, contaExterna: contaCanonica(plataforma, texto(linha.account_id)), nome: texto(linha.campaign) };
  const positivo = (n: number | null) => (n !== null && n > 0 ? n : null);

  if (plataforma === "facebook") {
    const moeda = texto(linha.account_currency).toUpperCase() || "BRL";
    // A Meta informa na menor unidade da moeda (centavos). Sem valor = o orçamento fica nos conjuntos de anúncios.
    const bruto = positivo(numero(linha.campaign_daily_budget));
    return {
      ...base, status: texto(linha.campaign_configured_status).toUpperCase() || null, moeda,
      orcamentoDiario: bruto === null ? null : MOEDAS_SEM_CENTAVOS.includes(moeda) ? bruto : bruto / 100,
    };
  }
  if (plataforma === "google_ads") {
    return {
      ...base, status: texto(linha.campaign_status).toUpperCase() || null,
      // A Windsor já devolve na moeda da conta (não em micros).
      orcamentoDiario: positivo(numero(linha.budget_amount)),
      moeda: texto(linha.account_currency_code).toUpperCase() || "BRL",
    };
  }
  const verba = positivo(numero(linha.campaign_budget));
  return {
    ...base, status: texto(linha.campaign_operation_status).toUpperCase() || null,
    // Só é "orçamento diário" quando a campanha usa verba por dia; verba total ou sem limite fica vazia.
    orcamentoDiario: texto(linha.campaign_budget_mode) === "BUDGET_MODE_DAY" ? verba : null,
    moeda: texto(linha.currency).toUpperCase() || "BRL",
  };
}

/** Objetivos da Meta (API de resultados, "OUTCOME_*"), os mesmos do provedor nativo. */
const OBJETIVO_META: Record<NovaCampanha["objetivo"], string> = {
  trafego: "OUTCOME_TRAFFIC",
  mensagens: "OUTCOME_ENGAGEMENT",
  conversoes: "OUTCOME_SALES",
  reconhecimento: "OUTCOME_AWARENESS",
};

/** Parâmetros de create_campaign da Meta na Windsor. Exportada para os testes: o status é sempre "paused". */
export function paramsNovaCampanhaWindsor(c: NovaCampanha): Record<string, unknown> {
  return {
    name: c.nome,
    objective: OBJETIVO_META[c.objetivo],
    status: "paused",
    special_ad_categories: [],
    daily_budget: Math.round(c.orcamentoDiarioReais * 100),
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  };
}

/** Traduz uma ação da JUDITE para a ação e os parâmetros da Windsor. Exportada para os testes. */
export function acaoDaWindsor(a: AcaoAnuncio): { action: string; params: Record<string, unknown> } {
  if (a.tipo === "definir_orcamento") {
    if (!(a.valorReais > 0)) throw new ErroProvedor("Valor de orçamento inválido.");
    if (a.plataforma === "google_ads") {
      // apply_to_shared_budget fica no padrão (false): orçamento compartilhado com outras campanhas é recusado pela Windsor.
      return { action: "set_campaign_budget", params: { campaign_id: a.campanhaId, budget_type: "daily", amount_micros: Math.round(a.valorReais * 1_000_000) } };
    }
    if (a.plataforma === "facebook") {
      return { action: "set_campaign_budget", params: { campaign_id: a.campanhaId, budget_type: "daily", amount: Math.round(a.valorReais * 100) } };
    }
    // TikTok pela Windsor: valor inteiro na moeda da conta. Arredondar mudaria o valor que passou pelos freios.
    if (!Number.isInteger(a.valorReais)) {
      throw new ErroProvedor("No TikTok, a Windsor só aceita orçamento em valor inteiro (sem centavos). Escolha um valor redondo.");
    }
    return { action: "set_campaign_budget", params: { campaign_id: a.campanhaId, amount: a.valorReais } };
  }
  const prefixo = a.tipo === "ativar" ? "enable" : "pause";
  if (a.entidade === "campanha") return { action: `${prefixo}_campaign`, params: { campaign_id: a.entidadeId } };
  if (a.entidade === "conjunto") {
    return a.plataforma === "facebook"
      ? { action: `${prefixo}_adset`, params: { adset_id: a.entidadeId } }
      : { action: `${prefixo}_ad_group`, params: { ad_group_id: a.entidadeId } };
  }
  // No Google Ads a Windsor pede também o ID do grupo de anúncios, que a JUDITE não guarda.
  if (a.plataforma === "google_ads") throw new ErroProvedor("Pausar ou ativar um anúncio do Google Ads pela Windsor ainda não está disponível.");
  return { action: `${prefixo}_ad`, params: { ad_id: a.entidadeId } };
}

/** Procura o ID da campanha criada na resposta da Windsor (o formato exato não é documentado). */
function idDaCampanhaCriada(resultado: unknown): string | null {
  const olhar = (v: unknown, nivel: number): string | null => {
    if (!v || typeof v !== "object" || nivel > 3) return null;
    const o = v as Record<string, unknown>;
    for (const k of ["campaign_id", "id"]) {
      if (typeof o[k] === "string" || typeof o[k] === "number") return String(o[k]);
    }
    for (const filho of Object.values(o)) {
      const achado = olhar(filho, nivel + 1);
      if (achado) return achado;
    }
    return null;
  };
  return olhar(resultado, 0);
}

export type CredenciaisWindsor = {
  chave: string;
  plataforma: Plataforma;
  /** Contas da Windsor que o dono escolheu para esta plataforma. */
  contas: ContaWindsor[];
  /** Para os testes: troca o cliente MCP por um simulado. */
  chamar?: ChamarWindsor;
};

export function provedorWindsor(cred: CredenciaisWindsor): ProvedorAnuncios {
  const { chave, plataforma } = cred;
  const chamar = cred.chamar ?? chamarWindsor;

  /** Das contas pedidas (formato da JUDITE), só as que o dono escolheu na Windsor, com o ID da Windsor. */
  function contasDoPedido(p: Periodo): string[] {
    if (p.plataforma !== plataforma) throw new ErroProvedor("Plataforma diferente da conexão da Windsor.");
    const ids = p.contas.length
      ? p.contas.map((c) => contaWindsorDe(plataforma, cred.contas, c)?.id).filter((id): id is string => Boolean(id))
      : cred.contas.map((c) => c.id);
    return [...new Set(ids)];
  }

  function contaDaAcao(conta: string): string {
    const achada = contaWindsorDe(plataforma, cred.contas, conta);
    if (!achada) throw new ErroProvedor("Essa conta de anúncios não está entre as escolhidas na Windsor (página Conexões).");
    return achada.id;
  }

  async function agir(conta: string, action: string, params: Record<string, unknown>): Promise<unknown> {
    const resultado = await chamar(chave, "execute_action", { connector: plataforma, action, account: contaDaAcao(conta), params });
    // O resultado vai para o histórico de ações: garante que a chave não esteja nele.
    try {
      return JSON.parse(semChave(JSON.stringify(resultado ?? null), chave));
    } catch {
      return null;
    }
  }

  const provedor: ProvedorAnuncios = {
    nome: "Windsor.ai",
    statusAtiva: STATUS[plataforma].ativa,
    statusPausada: STATUS[plataforma].pausada,

    async lerMetricas(p: Periodo) {
      const contas = contasDoPedido(p);
      if (!contas.length) return [];
      const cruas = await lerWindsor(chave, { conector: plataforma, campos: CAMPOS_METRICAS[plataforma], de: p.de, ate: p.ate, contas });
      return cruas.map((l) => metricaDaWindsor(plataforma, l)).filter((l): l is LinhaMetrica => l !== null);
    },

    async lerCampanhas(p: Periodo) {
      const contas = contasDoPedido(p);
      if (!contas.length) return [];
      const cruas = await lerWindsor(chave, { conector: plataforma, campos: CAMPOS_CAMPANHAS[plataforma], de: p.de, ate: p.ate, contas });
      // Fica só a linha do dia mais recente de cada campanha: é o estado atual.
      const recentes = new Map<string, { data: string; campanha: LinhaCampanha }>();
      for (const l of cruas) {
        const campanha = campanhaDaWindsor(plataforma, l);
        if (!campanha) continue;
        const data = texto(l.date).slice(0, 10);
        const anterior = recentes.get(campanha.campanhaId);
        if (!anterior || data >= anterior.data) recentes.set(campanha.campanhaId, { data, campanha });
      }
      return [...recentes.values()].map((r) => r.campanha);
    },

    async executar(acao: AcaoAnuncio) {
      if (acao.plataforma !== plataforma) throw new ErroProvedor("Plataforma diferente da conexão da Windsor.");
      const { action, params } = acaoDaWindsor(acao);
      return agir(acao.conta, action, params);
    },
  };

  // Criar campanha pela Windsor: só na Meta, onde os objetivos têm equivalente direto. Nasce sempre pausada.
  if (plataforma === "facebook") {
    provedor.criarCampanhaPausada = async (c: NovaCampanha) => {
      const id = idDaCampanhaCriada(await agir(c.conta, "create_campaign", paramsNovaCampanhaWindsor(c)));
      if (!id) throw new ErroProvedor("A Windsor não devolveu o ID da campanha criada. Confira no Gerenciador de Anúncios se ela foi criada (pausada).");
      return { campanhaId: id };
    };
  }
  return provedor;
}
