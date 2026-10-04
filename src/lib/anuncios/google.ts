/**
 * Provedor nativo do Google Ads, pela Google Ads API oficial (REST).
 * Usa as credenciais salvas (criptografadas) na página Conexões: developer token,
 * app OAuth (ID e chave secreta), refresh token e, se houver, a conta de administrador.
 *
 * Documentação: https://developers.google.com/google-ads/api/rest/overview
 *   - Leitura: POST customers/{id}/googleAds:search   (consulta GAQL)
 *   - Status:  POST customers/{id}/campaigns:mutate
 *   - Verba:   POST customers/{id}/campaignBudgets:mutate   (valor em micros: R$ 1 = 1.000.000)
 *
 * Depende da aprovação do developer token ("Acesso básico"). Enquanto o token estiver em
 * acesso de teste, o Google recusa contas reais e a mensagem de erro explica isso.
 *
 * Roda SOMENTE no servidor.
 */

import { GOOGLE_ADS_URL, GOOGLE_ADS_VERSAO, GOOGLE_TOKEN_URL, soDigitos } from "@/lib/conexoes/config";
import type { AcaoAnuncio, LinhaCampanha, LinhaMetrica } from "@/lib/trafego/tipos";
import { ErroProvedor, numero, pedirJson, texto } from "./http";
import type { Periodo, ProvedorAnuncios } from "./provedor";

const BASE = `${GOOGLE_ADS_URL}/${GOOGLE_ADS_VERSAO}`;
const MAX_PAGINAS = 50;
const MICROS = 1_000_000;

export type CredenciaisGoogle = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Conta de administrador (MCC), quando a conta de anúncios é gerenciada por uma. */
  gerente?: string | null;
};

type Linha = Record<string, Record<string, unknown> | undefined>;

const MENSAGENS: Record<string, string> = {
  DEVELOPER_TOKEN_NOT_APPROVED:
    "O developer token do Google Ads ainda está em acesso de teste. Peça o \"Acesso básico\" na Central de API da conta de administrador e aguarde a aprovação do Google.",
  DEVELOPER_TOKEN_PROHIBITED: "O developer token não pode ser usado com este projeto do Google Cloud. Use o mesmo projeto em que ele foi liberado.",
  CUSTOMER_NOT_ENABLED: "A conta do Google Ads não está ativa (pode estar cancelada ou ainda em configuração).",
  USER_PERMISSION_DENIED:
    "O e-mail que autorizou não tem acesso a essa conta do Google Ads. Se a conta é gerenciada por uma conta de administrador, informe o ID dela em Conexões.",
  OAUTH_TOKEN_REVOKED: "A autorização do Google foi revogada. Clique em \"Autorizar de novo\" em Conexões.",
  OAUTH_TOKEN_EXPIRED: "A autorização do Google expirou. Clique em \"Autorizar de novo\" em Conexões.",
};

/** Traduz o erro do Google Ads para uma frase clara. Exportada para os testes. */
export function erroDoGoogle(json: unknown): string | null {
  // googleAds:search devolve um objeto; searchStream devolve uma lista. Aceita os dois.
  const corpo = (Array.isArray(json) ? json[0] : json) as {
    error?: { message?: string; status?: string; details?: { errors?: { errorCode?: Record<string, string>; message?: string }[] }[] };
  } | null;
  const e = corpo?.error;
  if (!e) return null;
  const detalhes = (e.details ?? []).flatMap((d) => d.errors ?? []);
  for (const d of detalhes) {
    for (const codigo of Object.values(d.errorCode ?? {})) {
      if (MENSAGENS[codigo]) return MENSAGENS[codigo];
    }
  }
  return detalhes[0]?.message ?? e.message ?? e.status ?? "erro desconhecido";
}

/** Converte uma linha de métricas (GAQL em campaign, por dia). O Google não informa page view nem carrinho. */
export function metricaDoGoogle(linha: Linha, contaExterna: string): LinhaMetrica | null {
  const data = texto(linha.segments?.date).slice(0, 10);
  const campanhaId = texto(linha.campaign?.id);
  if (!data || !campanhaId) return null;
  const m = linha.metrics ?? {};
  return {
    data,
    plataforma: "google_ads",
    contaExterna,
    campanhaId,
    campanha: texto(linha.campaign?.name),
    // Leitura por campanha: Performance Max e campanhas inteligentes não expõem anúncio.
    anuncioId: "",
    anuncio: "",
    gasto: (numero(m.costMicros) ?? 0) / MICROS,
    impressoes: numero(m.impressions) ?? 0,
    cliques: numero(m.clicks) ?? 0,
    pageViews: null,
    addToCart: null,
    checkout: null,
    compras: numero(m.conversions) ?? 0,
    receita: numero(m.conversionsValue) ?? 0,
  };
}

export function campanhaDoGoogle(linha: Linha, contaExterna: string): LinhaCampanha | null {
  const campanhaId = texto(linha.campaign?.id);
  if (!campanhaId) return null;
  const micros = numero(linha.campaignBudget?.amountMicros);
  return {
    plataforma: "google_ads",
    campanhaId,
    contaExterna,
    nome: texto(linha.campaign?.name),
    status: texto(linha.campaign?.status) || null,
    orcamentoDiario: micros === null ? null : micros / MICROS,
    moeda: texto(linha.customer?.currencyCode) || "BRL",
  };
}

const ID_NUMERICO = /^\d{1,20}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function provedorGoogle(cred: CredenciaisGoogle): ProvedorAnuncios {
  let acesso: { token: string; expira: number } | null = null;

  /** Troca o refresh token salvo por um access token (vale cerca de 1 hora). */
  async function tokenDeAcesso(): Promise<string> {
    if (acesso && acesso.expira > Date.now() + 60_000) return acesso.token;
    const json = (await pedirJson("O Google", GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cred.clientId,
        client_secret: cred.clientSecret,
        refresh_token: cred.refreshToken,
      }),
    }, (j) => {
      const e = j as { error?: string; error_description?: string } | null;
      if (!e?.error) return null;
      return e.error === "invalid_grant"
        ? "a autorização do Google venceu ou foi revogada. Clique em \"Autorizar de novo\" em Conexões."
        : e.error_description ?? e.error;
    })) as { access_token?: string; expires_in?: number } | null;
    if (!json?.access_token) throw new ErroProvedor("O Google não devolveu o token de acesso.");
    acesso = { token: json.access_token, expira: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return acesso.token;
  }

  async function chamar(conta: string, caminho: string, corpo: unknown): Promise<unknown> {
    const cliente = soDigitos(conta);
    if (cliente.length !== 10) throw new ErroProvedor("ID do cliente do Google Ads inválido. Confira em Conexões.");
    const cabecalhos: Record<string, string> = {
      Authorization: `Bearer ${await tokenDeAcesso()}`,
      "developer-token": cred.developerToken,
      "Content-Type": "application/json",
    };
    const gerente = cred.gerente ? soDigitos(cred.gerente) : "";
    if (gerente) cabecalhos["login-customer-id"] = gerente;
    return pedirJson("O Google Ads", `${BASE}/customers/${cliente}/${caminho}`, {
      method: "POST", headers: cabecalhos, body: JSON.stringify(corpo),
    }, erroDoGoogle);
  }

  async function consultar(conta: string, query: string): Promise<Linha[]> {
    const linhas: Linha[] = [];
    let pageToken: string | undefined;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const json = (await chamar(conta, "googleAds:search", pageToken ? { query, pageToken } : { query })) as {
        results?: Linha[]; nextPageToken?: string;
      } | null;
      linhas.push(...(json?.results ?? []));
      pageToken = json?.nextPageToken;
      if (!pageToken) break;
    }
    return linhas;
  }

  return {
    nome: "Google Ads API",
    statusAtiva: "ENABLED",
    statusPausada: "PAUSED",

    async lerMetricas(p: Periodo) {
      if (!DATA.test(p.de) || !DATA.test(p.ate)) throw new ErroProvedor("Período inválido.");
      const saida: LinhaMetrica[] = [];
      for (const conta of p.contas) {
        const cruas = await consultar(conta,
          "SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, " +
          "metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign " +
          `WHERE segments.date BETWEEN '${p.de}' AND '${p.ate}'`);
        for (const l of cruas) {
          const m = metricaDoGoogle(l, conta);
          if (m) saida.push(m);
        }
      }
      return saida;
    },

    async lerCampanhas(p: Periodo) {
      const saida: LinhaCampanha[] = [];
      for (const conta of p.contas) {
        const cruas = await consultar(conta,
          "SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, customer.currency_code " +
          "FROM campaign WHERE campaign.status != 'REMOVED'");
        for (const l of cruas) {
          const c = campanhaDoGoogle(l, conta);
          if (c) saida.push(c);
        }
      }
      return saida;
    },

    async executar(acao: AcaoAnuncio) {
      const cliente = soDigitos(acao.conta);

      if (acao.tipo === "definir_orcamento") {
        if (!ID_NUMERICO.test(acao.campanhaId)) throw new ErroProvedor("ID de campanha inválido.");
        const [linha] = await consultar(acao.conta,
          "SELECT campaign_budget.resource_name, campaign_budget.explicitly_shared FROM campaign " +
          `WHERE campaign.id = ${acao.campanhaId}`);
        const orcamento = linha?.campaignBudget;
        if (!orcamento?.resourceName) throw new ErroProvedor("Não encontrei o orçamento dessa campanha no Google Ads.");
        // Orçamento compartilhado mexeria em outras campanhas ao mesmo tempo: melhor não tocar.
        if (orcamento.explicitlyShared === true) {
          throw new ErroProvedor("Essa campanha usa um orçamento compartilhado com outras. Mude direto no Google Ads.");
        }
        return chamar(acao.conta, "campaignBudgets:mutate", {
          operations: [{
            update: { resourceName: orcamento.resourceName, amountMicros: String(Math.round(acao.valorReais * MICROS)) },
            updateMask: "amount_micros",
          }],
        });
      }

      if (!ID_NUMERICO.test(acao.entidadeId)) throw new ErroProvedor("ID inválido.");
      const status = acao.tipo === "ativar" ? "ENABLED" : "PAUSED";
      if (acao.entidade === "campanha") {
        return chamar(acao.conta, "campaigns:mutate", {
          operations: [{ update: { resourceName: `customers/${cliente}/campaigns/${acao.entidadeId}`, status }, updateMask: "status" }],
        });
      }
      if (acao.entidade === "conjunto") {
        return chamar(acao.conta, "adGroups:mutate", {
          operations: [{ update: { resourceName: `customers/${cliente}/adGroups/${acao.entidadeId}`, status }, updateMask: "status" }],
        });
      }
      throw new ErroProvedor("Pausar ou ativar um anúncio isolado do Google Ads ainda não é suportado. Use a campanha.");
    },
  };
}
