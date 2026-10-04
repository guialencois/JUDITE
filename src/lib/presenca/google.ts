/**
 * Presença no Google: Perfil da Empresa (antigo Google Meu Negócio) e Search Console,
 * pelas APIs oficiais. SOMENTE no servidor.
 *
 * Documentação:
 *   - Contas:       GET  mybusinessaccountmanagement.googleapis.com/v1/accounts
 *   - Locais:       GET  mybusinessbusinessinformation.googleapis.com/v1/{conta}/locations?readMask=...
 *   - Avaliações:   GET  mybusiness.googleapis.com/v4/{conta}/{local}/reviews
 *   - Responder:    PUT  mybusiness.googleapis.com/v4/{avaliacao}/reply          (só com aprovação)
 *   - Publicar:     POST mybusiness.googleapis.com/v4/{conta}/{local}/localPosts (só com aprovação)
 *   - Desempenho:   GET  businessprofileperformance.googleapis.com/v1/{local}:fetchMultiDailyMetricsTimeSeries
 *   - Search Console: GET webmasters/v3/sites  e  POST webmasters/v3/sites/{site}/searchAnalytics/query
 *
 * ATENÇÃO: as APIs do Perfil da Empresa só funcionam depois que o Google aprova um pedido de
 * acesso para o projeto do Google Cloud (a cota começa em zero). Enquanto isso, as leituras
 * falham com uma mensagem explicando, e a parte do Search Console funciona normalmente.
 *
 * Usa o mesmo app OAuth do workspace (salvo na conexão do Google Ads) com outro consentimento:
 * escopos business.manage e webmasters.readonly, guardados na conexão "google_presenca".
 */

import { ErroProvedor, numero, pedirJson, texto } from "@/lib/anuncios/http";
import { GOOGLE_TOKEN_URL } from "@/lib/conexoes/config";
import { lerConexao } from "@/lib/conexoes/segredos";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;
type Json = Record<string, unknown>;

export const ESCOPOS_PRESENCA = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

const CONTAS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_URL = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4_URL = "https://mybusiness.googleapis.com/v4";
const DESEMPENHO_URL = "https://businessprofileperformance.googleapis.com/v1";
const GSC_URL = "https://www.googleapis.com/webmasters/v3";

const ID_CONTA = /^accounts\/[0-9]{1,30}$/;
const ID_LOCAL = /^locations\/[0-9]{1,30}$/;
export const contaValida = (v: unknown): v is string => typeof v === "string" && ID_CONTA.test(v);
export const localValido = (v: unknown): v is string => typeof v === "string" && ID_LOCAL.test(v);
/** Propriedade do Search Console: "https://site/" ou "sc-domain:site". */
export const siteGscValido = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 200 && /^(https?:\/\/[a-z0-9.-]+(:\d+)?\/[^\s]*|sc-domain:[a-z0-9.-]+)$/i.test(v);

export function erroDoGoogleApis(json: unknown): string | null {
  const e = (json as { error?: { message?: string; status?: string; code?: number } | string; error_description?: string } | null)?.error;
  if (!e) return null;
  if (typeof e === "string") {
    return e === "invalid_grant"
      ? "a autorização do Google venceu ou foi revogada. Autorize de novo em Conexões."
      : (json as { error_description?: string }).error_description ?? e;
  }
  const mensagem = e.message ?? e.status ?? "erro desconhecido";
  if (e.code === 429 || /quota/i.test(mensagem)) {
    return "o Google ainda não liberou cota para esta API neste projeto. Para o Perfil da Empresa é preciso pedir acesso à Business Profile API (veja o passo a passo em Conexões).";
  }
  if (e.code === 403 && /has not been used|is disabled|not enabled/i.test(mensagem)) {
    return "esta API não está ativada no projeto do Google Cloud. Ative-a em APIs e serviços → Biblioteca (veja o passo a passo em Conexões).";
  }
  return mensagem;
}

export type AcessoPresenca = { token: string; conta: string | null; local: string | null; siteGsc: string | null };

/** Abre a conexão e troca o refresh token por um access token. Devolve o motivo quando não dá. */
export async function abrirPresenca(db: Admin, workspaceId: string): Promise<{ ok: true; acesso: AcessoPresenca } | { ok: false; motivo: string }> {
  let app: Awaited<ReturnType<typeof lerConexao>>;
  let presenca: Awaited<ReturnType<typeof lerConexao>>;
  try {
    [app, presenca] = await Promise.all([lerConexao(db, workspaceId, "google_ads"), lerConexao(db, workspaceId, "google_presenca")]);
  } catch {
    return { ok: false, motivo: "Não foi possível abrir a conexão do Google. Refaça a conexão na página Conexões." };
  }
  if (!app.segredos.client_id || !app.segredos.client_secret) {
    return { ok: false, motivo: "Falta o app OAuth do Google (Parte B do Google Ads, em Conexões)." };
  }
  if (!presenca.segredos.refresh_token) {
    return { ok: false, motivo: "Autorize a Presença no Google em Conexões." };
  }
  try {
    const json = (await pedirJson("O Google", GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: app.segredos.client_id,
        client_secret: app.segredos.client_secret,
        refresh_token: presenca.segredos.refresh_token,
      }),
    }, erroDoGoogleApis)) as { access_token?: string } | null;
    if (!json?.access_token) return { ok: false, motivo: "O Google não devolveu o token de acesso." };
    const d = presenca.dados;
    return {
      ok: true,
      acesso: {
        token: json.access_token,
        conta: contaValida(d.conta) ? d.conta : null,
        local: localValido(d.local) ? d.local : null,
        siteGsc: siteGscValido(d.site_gsc) ? d.site_gsc : null,
      },
    };
  } catch (erro) {
    return { ok: false, motivo: erro instanceof Error ? erro.message : "Falha ao falar com o Google." };
  }
}

async function chamar(token: string, url: string, init: RequestInit = {}): Promise<Json> {
  const json = await pedirJson("O Google", url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  }, erroDoGoogleApis);
  return (json ?? {}) as Json;
}

// ------------------------------------------------------------------ leitura

export type LocalPerfil = {
  conta: string; local: string; titulo: string; endereco: string; site: string | null; telefone: string | null;
  categoria: string | null; descricao: string | null; temHorario: boolean;
};

function localDe(conta: string, l: Json): LocalPerfil {
  const end = (l.storefrontAddress ?? {}) as Json;
  const linhas = Array.isArray(end.addressLines) ? (end.addressLines as unknown[]).map(texto) : [];
  const periodos = ((l.regularHours ?? {}) as Json).periods;
  return {
    conta,
    local: texto(l.name),
    titulo: texto(l.title),
    endereco: [...linhas, texto(end.locality), texto(end.administrativeArea)].filter(Boolean).join(", "),
    site: texto(l.websiteUri) || null,
    telefone: texto(((l.phoneNumbers ?? {}) as Json).primaryPhone) || null,
    categoria: texto((((l.categories ?? {}) as Json).primaryCategory as Json | undefined)?.displayName) || null,
    descricao: texto(((l.profile ?? {}) as Json).description) || null,
    temHorario: Array.isArray(periodos) && periodos.length > 0,
  };
}

const MASCARA = "name,title,storefrontAddress,websiteUri,phoneNumbers,categories,regularHours,profile";

/** Todos os locais (perfis) que a conta autorizada administra. Usado para o dono escolher qual é o do workspace. */
export async function listarLocais(token: string): Promise<LocalPerfil[]> {
  const contas = ((await chamar(token, `${CONTAS_URL}/accounts`)).accounts ?? []) as Json[];
  const saida: LocalPerfil[] = [];
  for (const c of contas.slice(0, 10)) {
    const conta = texto(c.name);
    if (!contaValida(conta)) continue;
    const r = await chamar(token, `${INFO_URL}/${conta}/locations?readMask=${MASCARA}&pageSize=100`);
    for (const l of (r.locations ?? []) as Json[]) saida.push(localDe(conta, l));
  }
  return saida;
}

export async function lerLocal(a: AcessoPresenca): Promise<LocalPerfil> {
  if (!a.conta || !a.local) throw new ErroProvedor("Escolha o perfil da empresa na página Presença no Google.");
  return localDe(a.conta, await chamar(a.token, `${INFO_URL}/${a.local}?readMask=${MASCARA}`));
}

const ESTRELAS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export type Avaliacao = {
  /** Nome do recurso: accounts/x/locations/y/reviews/z */
  nome: string; autor: string; estrelas: number | null; comentario: string | null; criadaEm: string | null;
  resposta: string | null;
};
export type Avaliacoes = { media: number | null; total: number | null; lista: Avaliacao[] };

export function avaliacoesDe(json: Json): Avaliacoes {
  const lista = ((json.reviews ?? []) as Json[]).map((r) => ({
    nome: texto(r.name),
    autor: texto(((r.reviewer ?? {}) as Json).displayName) || "Cliente",
    estrelas: ESTRELAS[texto(r.starRating)] ?? null,
    comentario: texto(r.comment) || null,
    criadaEm: texto(r.createTime) || null,
    resposta: texto(((r.reviewReply ?? {}) as Json).comment) || null,
  }));
  return { media: numero(json.averageRating), total: numero(json.totalReviewCount), lista };
}

export async function lerAvaliacoes(a: AcessoPresenca): Promise<Avaliacoes> {
  if (!a.conta || !a.local) throw new ErroProvedor("Escolha o perfil da empresa na página Presença no Google.");
  return avaliacoesDe(await chamar(a.token, `${V4_URL}/${a.conta}/${a.local}/reviews?pageSize=50&orderBy=updateTime%20desc`));
}

const METRICAS_PERFIL = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "WEBSITE_CLICKS", "CALL_CLICKS", "BUSINESS_DIRECTION_REQUESTS",
] as const;

export type DesempenhoPerfil = { dias: number; visualizacoes: number; cliquesNoSite: number; ligacoes: number; rotas: number };

/** Soma as séries diárias devolvidas pela API de desempenho. Exportada para os testes. */
export function desempenhoDe(json: Json, dias: number): DesempenhoPerfil {
  const somas: Record<string, number> = {};
  for (const grupo of (json.multiDailyMetricTimeSeries ?? []) as Json[]) {
    for (const serie of (grupo.dailyMetricTimeSeries ?? []) as Json[]) {
      const valores = (((serie.timeSeries ?? {}) as Json).datedValues ?? []) as Json[];
      const metrica = texto(serie.dailyMetric);
      somas[metrica] = (somas[metrica] ?? 0) + valores.reduce((s, v) => s + (numero(v.value) ?? 0), 0);
    }
  }
  const s = (k: string) => somas[k] ?? 0;
  return {
    dias,
    visualizacoes: s("BUSINESS_IMPRESSIONS_DESKTOP_MAPS") + s("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH")
      + s("BUSINESS_IMPRESSIONS_MOBILE_MAPS") + s("BUSINESS_IMPRESSIONS_MOBILE_SEARCH"),
    cliquesNoSite: s("WEBSITE_CLICKS"),
    ligacoes: s("CALL_CLICKS"),
    rotas: s("BUSINESS_DIRECTION_REQUESTS"),
  };
}

const partes = (iso: string) => iso.split("-").map(Number);

export async function lerDesempenho(a: AcessoPresenca, de: string, ate: string, dias: number): Promise<DesempenhoPerfil> {
  if (!a.local) throw new ErroProvedor("Escolha o perfil da empresa na página Presença no Google.");
  const [ay, am, ad] = partes(de);
  const [by, bm, bd] = partes(ate);
  const busca = new URLSearchParams();
  for (const m of METRICAS_PERFIL) busca.append("dailyMetrics", m);
  busca.set("dailyRange.start_date.year", String(ay));
  busca.set("dailyRange.start_date.month", String(am));
  busca.set("dailyRange.start_date.day", String(ad));
  busca.set("dailyRange.end_date.year", String(by));
  busca.set("dailyRange.end_date.month", String(bm));
  busca.set("dailyRange.end_date.day", String(bd));
  return desempenhoDe(await chamar(a.token, `${DESEMPENHO_URL}/${a.local}:fetchMultiDailyMetricsTimeSeries?${busca.toString()}`), dias);
}

// ------------------------------------------------------------------ Search Console

export type LinhaBusca = { chave: string; cliques: number; impressoes: number; ctr: number; posicao: number };

export function linhasDeBusca(json: Json): LinhaBusca[] {
  return ((json.rows ?? []) as Json[]).map((r) => ({
    chave: Array.isArray(r.keys) ? texto((r.keys as unknown[])[0]) : "",
    cliques: numero(r.clicks) ?? 0,
    impressoes: numero(r.impressions) ?? 0,
    ctr: numero(r.ctr) ?? 0,
    posicao: numero(r.position) ?? 0,
  }));
}

export async function listarSitesGsc(token: string): Promise<string[]> {
  const r = await chamar(token, `${GSC_URL}/sites`);
  return ((r.siteEntry ?? []) as Json[])
    .filter((s) => texto(s.permissionLevel) !== "siteUnverifiedUser")
    .map((s) => texto(s.siteUrl)).filter(siteGscValido);
}

export async function lerBusca(a: AcessoPresenca, de: string, ate: string, dimensao: "query" | "page" | null, limite = 25): Promise<LinhaBusca[]> {
  if (!a.siteGsc) throw new ErroProvedor("Escolha a propriedade do Search Console na página Presença no Google.");
  const corpo: Json = { startDate: de, endDate: ate, rowLimit: limite };
  if (dimensao) corpo.dimensions = [dimensao];
  return linhasDeBusca(await chamar(a.token, `${GSC_URL}/sites/${encodeURIComponent(a.siteGsc)}/searchAnalytics/query`, {
    method: "POST", body: JSON.stringify(corpo),
  }));
}

// ------------------------------------------------------------------ escrita (só depois de aprovação humana)

const NOME_AVALIACAO = /^accounts\/[0-9]{1,30}\/locations\/[0-9]{1,30}\/reviews\/[A-Za-z0-9_-]{1,200}$/;
export const avaliacaoValida = (v: unknown): v is string => typeof v === "string" && NOME_AVALIACAO.test(v);

/** Publica a resposta a uma avaliação. Chamar SOMENTE a partir de uma ação aprovada pelo dono. */
export async function responderAvaliacao(a: AcessoPresenca, avaliacao: string, comentario: string): Promise<unknown> {
  if (!avaliacaoValida(avaliacao) || !a.conta || !a.local || !avaliacao.startsWith(`${a.conta}/${a.local}/`)) {
    throw new ErroProvedor("Essa avaliação não pertence ao perfil deste workspace.");
  }
  return chamar(a.token, `${V4_URL}/${avaliacao}/reply`, { method: "PUT", body: JSON.stringify({ comment: comentario }) });
}

/** Publica um post (novidade) no perfil. Chamar SOMENTE a partir de uma ação aprovada pelo dono. */
export async function publicarPost(a: AcessoPresenca, textoDoPost: string): Promise<unknown> {
  if (!a.conta || !a.local) throw new ErroProvedor("Escolha o perfil da empresa na página Presença no Google.");
  return chamar(a.token, `${V4_URL}/${a.conta}/${a.local}/localPosts`, {
    method: "POST", body: JSON.stringify({ languageCode: "pt-BR", summary: textoDoPost, topicType: "STANDARD" }),
  });
}
