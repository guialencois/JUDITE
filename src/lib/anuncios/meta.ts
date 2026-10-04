/**
 * Provedor nativo da Meta (Facebook e Instagram Ads), pela Marketing API oficial.
 * Usa o token do usuário do sistema salvo (criptografado) na página Conexões.
 *
 * Documentação: https://developers.facebook.com/docs/marketing-api
 *   - Insights:  GET  /act_{conta}/insights  (level=ad, time_increment=1)
 *   - Campanhas: GET  /act_{conta}/campaigns
 *   - Ações:     POST /{id}  com status=PAUSED|ACTIVE ou daily_budget (em centavos)
 *
 * Roda SOMENTE no servidor. O token vai sempre no cabeçalho Authorization, nunca na URL.
 */

import { META_GRAPH_URL, META_VERSAO } from "@/lib/conexoes/config";
import type { AcaoAnuncio, LinhaCampanha, LinhaMetrica } from "@/lib/trafego/tipos";
import { ErroProvedor, numero, pedirJson, texto } from "./http";
import type { NovaCampanha, Periodo, ProvedorAnuncios } from "./provedor";

const BASE = `${META_GRAPH_URL}/${META_VERSAO}`;
/** Trava de segurança contra paginação sem fim. */
const MAX_PAGINAS = 50;

type Linha = Record<string, unknown>;
type ItemAcao = { action_type?: string; value?: string | number };

/** "123" ou "act_123" -> "act_123" */
export const contaMeta = (conta: string) => (conta.startsWith("act_") ? conta : `act_${conta.replace(/\D/g, "")}`);

function erroDaMeta(json: unknown): string | null {
  const e = (json as { error?: { message?: string; code?: number; error_user_msg?: string } } | null)?.error;
  if (!e) return null;
  return `${e.error_user_msg ?? e.message ?? "erro desconhecido"}${e.code ? ` (código ${e.code})` : ""}`;
}

/**
 * Soma o valor de uma ação. Os tipos vêm por ordem de preferência e só o PRIMEIRO encontrado
 * conta: a Meta repete a mesma compra em vários tipos (purchase, omni_purchase, pixel...).
 */
export function valorDaAcao(lista: unknown, tipos: string[]): number | null {
  if (!Array.isArray(lista)) return null;
  for (const tipo of tipos) {
    const item = (lista as ItemAcao[]).find((a) => a?.action_type === tipo);
    const n = item ? numero(item.value) : null;
    if (n !== null) return n;
  }
  return null;
}

const TIPOS = {
  cliques: ["link_click"],
  pageViews: ["landing_page_view"],
  addToCart: ["offsite_conversion.fb_pixel_add_to_cart", "add_to_cart", "omni_add_to_cart"],
  checkout: ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout", "omni_initiated_checkout"],
  compras: ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"],
};

/** Converte uma linha de /insights para o formato do painel. Exportada para os testes. */
export function metricaDaMeta(linha: Linha, contaExterna: string): LinhaMetrica | null {
  const data = texto(linha.date_start).slice(0, 10);
  if (!data) return null;
  return {
    data,
    plataforma: "facebook",
    contaExterna,
    campanhaId: texto(linha.campaign_id),
    campanha: texto(linha.campaign_name),
    anuncioId: texto(linha.ad_id),
    anuncio: texto(linha.ad_name),
    gasto: numero(linha.spend) ?? 0,
    impressoes: numero(linha.impressions) ?? 0,
    // Clique no link é o que leva ao site; "clicks" inclui curtidas e cliques no perfil.
    cliques: valorDaAcao(linha.actions, TIPOS.cliques) ?? numero(linha.inline_link_clicks) ?? numero(linha.clicks) ?? 0,
    // A Meta informa estas métricas: ausência na resposta significa zero no dia.
    pageViews: valorDaAcao(linha.actions, TIPOS.pageViews) ?? 0,
    addToCart: valorDaAcao(linha.actions, TIPOS.addToCart) ?? 0,
    checkout: valorDaAcao(linha.actions, TIPOS.checkout) ?? 0,
    compras: valorDaAcao(linha.actions, TIPOS.compras) ?? 0,
    receita: valorDaAcao(linha.action_values, TIPOS.compras) ?? 0,
  };
}

/** Converte uma linha de /campaigns. A Meta devolve o orçamento na menor unidade da moeda (centavos). */
export function campanhaDaMeta(linha: Linha, contaExterna: string, moeda: string): LinhaCampanha | null {
  const campanhaId = texto(linha.id);
  if (!campanhaId) return null;
  const centavos = numero(linha.daily_budget);
  return {
    plataforma: "facebook",
    campanhaId,
    contaExterna,
    nome: texto(linha.name),
    status: texto(linha.status) || null,
    // Sem daily_budget = o orçamento fica nos conjuntos de anúncios, não na campanha.
    orcamentoDiario: centavos === null || centavos <= 0 ? null : centavos / 100,
    moeda,
  };
}

/** Objetivos da Meta (API de resultados, "OUTCOME_*"). */
const OBJETIVO_META: Record<NovaCampanha["objetivo"], string> = {
  trafego: "OUTCOME_TRAFFIC",
  mensagens: "OUTCOME_ENGAGEMENT",
  conversoes: "OUTCOME_SALES",
  reconhecimento: "OUTCOME_AWARENESS",
};

/** Campos enviados para criar a campanha na Meta. Exportada para os testes: o status é sempre PAUSED. */
export function camposNovaCampanhaMeta(c: NovaCampanha): Record<string, string> {
  return {
    name: c.nome,
    objective: OBJETIVO_META[c.objetivo],
    status: "PAUSED",
    special_ad_categories: "[]",
    daily_budget: String(Math.round(c.orcamentoDiarioReais * 100)),
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  };
}

export function provedorMeta(cred: { token: string; moeda?: string | null }): ProvedorAnuncios {
  const cabecalhos = { Authorization: `Bearer ${cred.token}` };

  async function listar(caminho: string, busca: Record<string, string>): Promise<Linha[]> {
    const linhas: Linha[] = [];
    let url: string | null = `${BASE}/${caminho}?${new URLSearchParams(busca).toString()}`;
    for (let pagina = 0; url && pagina < MAX_PAGINAS; pagina++) {
      const json = (await pedirJson("A Meta", url, { headers: cabecalhos }, erroDaMeta)) as {
        data?: Linha[]; paging?: { next?: string };
      } | null;
      linhas.push(...(json?.data ?? []));
      url = json?.paging?.next ?? null;
    }
    return linhas;
  }

  async function alterar(id: string, campos: Record<string, string>): Promise<unknown> {
    return pedirJson("A Meta", `${BASE}/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { ...cabecalhos, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(campos),
    }, erroDaMeta);
  }

  return {
    nome: "Meta Marketing API",
    statusAtiva: "ACTIVE",
    statusPausada: "PAUSED",

    async lerMetricas(p: Periodo) {
      const saida: LinhaMetrica[] = [];
      for (const conta of p.contas) {
        const cruas = await listar(`${contaMeta(conta)}/insights`, {
          level: "ad",
          time_increment: "1",
          time_range: JSON.stringify({ since: p.de, until: p.ate }),
          fields: "campaign_id,campaign_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,actions,action_values",
          limit: "500",
        });
        for (const l of cruas) {
          const m = metricaDaMeta(l, conta);
          if (m) saida.push(m);
        }
      }
      return saida;
    },

    async lerCampanhas(p: Periodo) {
      const saida: LinhaCampanha[] = [];
      for (const conta of p.contas) {
        const cruas = await listar(`${contaMeta(conta)}/campaigns`, {
          fields: "id,name,status,effective_status,daily_budget",
          limit: "200",
        });
        for (const l of cruas) {
          const c = campanhaDaMeta(l, conta, cred.moeda || "BRL");
          if (c) saida.push(c);
        }
      }
      return saida;
    },

    async executar(acao: AcaoAnuncio) {
      if (acao.tipo === "definir_orcamento") {
        return alterar(acao.campanhaId, { daily_budget: String(Math.round(acao.valorReais * 100)) });
      }
      return alterar(acao.entidadeId, { status: acao.tipo === "ativar" ? "ACTIVE" : "PAUSED" });
    },

    async criarCampanhaPausada(c: NovaCampanha) {
      const json = (await pedirJson("A Meta", `${BASE}/${contaMeta(c.conta)}/campaigns`, {
        method: "POST",
        headers: { ...cabecalhos, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(camposNovaCampanhaMeta(c)),
      }, erroDaMeta)) as { id?: string } | null;
      if (!json?.id) throw new ErroProvedor("A Meta não devolveu o ID da campanha criada.");
      return { campanhaId: String(json.id) };
    },
  };
}
