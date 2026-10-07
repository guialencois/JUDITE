/**
 * Conversa com as plataformas durante a conexão: trocar o código por token, listar as contas que o
 * dono pode escolher e revogar o acesso ao desconectar. SOMENTE no servidor.
 *
 * Todas as funções devolvem erro em português e NUNCA colocam token, código ou chave em mensagem.
 * Endpoints (documentação oficial):
 *   Google  oauth2.googleapis.com/token e /revoke · googleads customers:listAccessibleCustomers · GAQL customer_client
 *   Meta    graph oauth/access_token (code e fb_exchange_token) · /me/adaccounts · DELETE /me/permissions · appsecret_proof
 *   TikTok  oauth2/access_token · oauth2/advertiser/get
 */

import { createHmac } from "node:crypto";
import { GOOGLE_ADS_URL, GOOGLE_ADS_VERSAO, GOOGLE_TOKEN_URL, META_GRAPH_URL, META_VERSAO, TIKTOK_API_URL } from "./config";

export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TEMPO_LIMITE_MS = 20_000;
const MAX_CONTAS = 50;
/** Quantas contas "raiz" do Google são abertas para procurar contas-clientes (cada uma é um pedido). */
const MAX_RAIZES_GOOGLE = 10;

export type ContaDisponivel = {
  id: string;
  nome: string;
  moeda?: string | null;
  /** Google: conta de administrador (MCC) pela qual a conta é acessada. */
  gerente?: string | null;
  /** Meta: 1 = ativa. */
  status?: number | null;
};

export type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: string };
const falha = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo });

async function pedir(url: string, init: RequestInit = {}): Promise<{ status: number; json: unknown } | null> {
  try {
    const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch {
    return null;
  }
}
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const comTracos = (v: string) => (v.length === 10 ? `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}` : v);

// ---------------------------------------------------------------------------------------------- Google

export type TokensGoogle = { refreshToken: string; accessToken: string };

/** Troca o código de autorização pelos tokens. O verificador PKCE prova que quem troca é quem começou o pedido. */
export async function trocarCodigoGoogle(e: {
  code: string; clientId: string; clientSecret: string; redirectUri: string; verificador?: string;
}): Promise<Resultado<TokensGoogle>> {
  const r = await pedir(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: e.code, client_id: e.clientId, client_secret: e.clientSecret, redirect_uri: e.redirectUri, grant_type: "authorization_code",
      ...(e.verificador ? { code_verifier: e.verificador } : {}),
    }),
  });
  if (!r) return falha("Não foi possível falar com o Google (rede ou tempo esgotado).");
  const j = r.json as { refresh_token?: string; access_token?: string } | null;
  if (r.status !== 200 || !j?.access_token) return falha("O Google recusou o código de autorização. Tente conectar de novo.");
  if (!j.refresh_token) {
    return falha("O Google não devolveu o acesso permanente. Remova o acesso da JUDITE em myaccount.google.com/permissions e conecte outra vez.");
  }
  return { ok: true, valor: { refreshToken: j.refresh_token, accessToken: j.access_token } };
}

/** O Google devolve invalid_grant quando o refresh token venceu ou foi revogado: a conexão precisa ser refeita. */
export const ehRevogacaoGoogle = (json: unknown): boolean => (json as { error?: string } | null)?.error === "invalid_grant";

/**
 * Lista as contas do Google Ads que o e-mail autorizado alcança: as contas diretas e, quando uma
 * delas é conta de administrador (MCC), as contas-clientes dela. Só entram contas de anúncios ativas.
 */
export async function listarContasGoogle(e: { accessToken: string; developerToken: string; mccPadrao?: string | null }): Promise<Resultado<ContaDisponivel[]>> {
  const base = `${GOOGLE_ADS_URL}/${GOOGLE_ADS_VERSAO}`;
  const cabecalhos = { Authorization: `Bearer ${e.accessToken}`, "developer-token": e.developerToken };

  const lista = await pedir(`${base}/customers:listAccessibleCustomers`, { headers: cabecalhos });
  if (!lista) return falha("Não foi possível falar com o Google Ads (rede ou tempo esgotado).");
  const nomes = (lista.json as { resourceNames?: string[] } | null)?.resourceNames;
  if (lista.status !== 200 || !Array.isArray(nomes)) {
    const texto = JSON.stringify(lista.json ?? "");
    if (/DEVELOPER_TOKEN_NOT_APPROVED/.test(texto)) {
      return falha("O developer token do Google Ads ainda está em acesso de teste: ele só enxerga contas de teste. Peça o \"Acesso básico\" na Central de API.");
    }
    if (/DEVELOPER_TOKEN/.test(texto)) return falha("O Google recusou o developer token. Confira o valor de GOOGLE_ADS_DEVELOPER_TOKEN.");
    return falha("O Google Ads não devolveu a lista de contas. Confira se a Google Ads API está ativada no projeto do Google Cloud.");
  }

  const raizes = [...new Set([...(e.mccPadrao ? [e.mccPadrao] : []), ...nomes.map(digitos)])].filter((id) => id.length === 10).slice(0, MAX_RAIZES_GOOGLE);
  const contas = new Map<string, ContaDisponivel>();
  const query = "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level, " +
    "customer_client.currency_code, customer_client.status FROM customer_client WHERE customer_client.level <= 1 AND customer_client.status = 'ENABLED'";

  for (const raiz of raizes) {
    const r = await pedir(`${base}/customers/${raiz}/googleAds:search`, {
      method: "POST",
      headers: { ...cabecalhos, "login-customer-id": raiz, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const linhas = (r?.status === 200 ? (r.json as { results?: { customerClient?: Record<string, unknown> }[] } | null)?.results : null) ?? [];
    const raizEhGerente = linhas.some((l) => digitos(l.customerClient?.id) === raiz && l.customerClient?.manager === true);
    for (const l of linhas) {
      const c = l.customerClient ?? {};
      const id = digitos(c.id);
      if (id.length !== 10 || c.manager === true || contas.has(id)) continue;
      contas.set(id, {
        id: comTracos(id),
        nome: String(c.descriptiveName ?? "").trim() || `Conta ${comTracos(id)}`,
        moeda: typeof c.currencyCode === "string" ? c.currencyCode : null,
        gerente: raizEhGerente && id !== raiz ? comTracos(raiz) : null,
      });
    }
  }
  return { ok: true, valor: [...contas.values()].slice(0, MAX_CONTAS) };
}

// ---------------------------------------------------------------------------------------------- Meta

/** appsecret_proof: HMAC-SHA256 do token de acesso, com a chave secreta do app, em hexadecimal. */
export function provaDoApp(token: string, segredoDoApp: string): string {
  return createHmac("sha256", segredoDoApp).update(token).digest("hex");
}

export type TokenMeta = { token: string; expiraEm: string | null };

function erroDaMeta(json: unknown): { code?: number; message?: string } | null {
  return (json as { error?: { code?: number; message?: string } } | null)?.error ?? null;
}
/** Código 190 da Meta: token vencido, revogado ou inválido. */
export const ehRevogacaoMeta = (json: unknown): boolean => erroDaMeta(json)?.code === 190;

/**
 * Troca o código por um token de usuário e, em seguida, por um token de longa duração (cerca de 60 dias).
 * A Meta documenta estas duas chamadas como GET, com os dados na consulta; elas saem só do servidor.
 */
export async function trocarCodigoMeta(e: { code: string; appId: string; appSecret: string; redirectUri: string; agora?: Date }): Promise<Resultado<TokenMeta>> {
  const url = `${META_GRAPH_URL}/${META_VERSAO}/oauth/access_token`;
  const curto = await pedir(`${url}?${new URLSearchParams({ client_id: e.appId, redirect_uri: e.redirectUri, client_secret: e.appSecret, code: e.code })}`);
  if (!curto) return falha("Não foi possível falar com a Meta (rede ou tempo esgotado).");
  const tokenCurto = (curto.json as { access_token?: string } | null)?.access_token;
  if (curto.status !== 200 || !tokenCurto) return falha("A Meta recusou o código de autorização. Tente conectar de novo.");

  const longo = await pedir(`${url}?${new URLSearchParams({
    grant_type: "fb_exchange_token", client_id: e.appId, client_secret: e.appSecret, fb_exchange_token: tokenCurto,
  })}`);
  const j = longo?.json as { access_token?: string; expires_in?: number | string } | null;
  if (!longo || longo.status !== 200 || !j?.access_token) return falha("A Meta não devolveu o acesso de longa duração. Tente conectar de novo.");
  const segundos = Number(j.expires_in);
  const agora = (e.agora ?? new Date()).getTime();
  return { ok: true, valor: { token: j.access_token, expiraEm: Number.isFinite(segundos) && segundos > 0 ? new Date(agora + segundos * 1000).toISOString() : null } };
}

/** Contas de anúncios que a pessoa que autorizou pode usar (/me/adaccounts). */
export async function listarContasMeta(e: { token: string; appSecret: string }): Promise<Resultado<ContaDisponivel[]>> {
  const contas: ContaDisponivel[] = [];
  let url: string | null = `${META_GRAPH_URL}/${META_VERSAO}/me/adaccounts?${new URLSearchParams({
    fields: "name,account_id,currency,account_status", limit: "100", appsecret_proof: provaDoApp(e.token, e.appSecret),
  })}`;
  for (let pagina = 0; url && pagina < 5; pagina++) {
    const r = await pedir(url, { headers: { Authorization: `Bearer ${e.token}` } });
    if (!r) return falha("Não foi possível falar com a Meta (rede ou tempo esgotado).");
    const j = r.json as { data?: Record<string, unknown>[]; paging?: { next?: string } } | null;
    if (r.status !== 200 || !Array.isArray(j?.data)) {
      return falha(ehRevogacaoMeta(r.json) ? "A autorização da Meta venceu ou foi revogada. Conecte de novo." : "A Meta não devolveu as contas de anúncios. Confira as permissões concedidas no login.");
    }
    for (const c of j.data) {
      const id = digitos(c.account_id ?? c.id);
      if (!id) continue;
      contas.push({
        id: `act_${id}`, nome: String(c.name ?? "").trim() || `Conta ${id}`,
        moeda: typeof c.currency === "string" ? c.currency : null, status: typeof c.account_status === "number" ? c.account_status : null,
      });
    }
    url = j.paging?.next ?? null;
  }
  return { ok: true, valor: contas.slice(0, MAX_CONTAS) };
}

// ---------------------------------------------------------------------------------------------- TikTok

/** Troca o auth_code pelo token de acesso do TikTok for Business. */
export async function trocarCodigoTikTok(e: { authCode: string; appId: string; secret: string }): Promise<Resultado<{ token: string; anunciantes: string[] }>> {
  const r = await pedir(`${TIKTOK_API_URL}/oauth2/access_token/`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: e.appId, secret: e.secret, auth_code: e.authCode }),
  });
  if (!r) return falha("Não foi possível falar com o TikTok (rede ou tempo esgotado).");
  const j = r.json as { code?: number; data?: { access_token?: string; advertiser_ids?: unknown[] } } | null;
  if (j?.code !== 0 || !j.data?.access_token) return falha("O TikTok não devolveu o acesso. Confira o app e tente conectar de novo.");
  return { ok: true, valor: { token: j.data.access_token, anunciantes: (j.data.advertiser_ids ?? []).map(String).slice(0, MAX_CONTAS) } };
}

/** Anunciantes que autorizaram o app (oauth2/advertiser/get). O TikTok pede app_id e secret na consulta deste GET. */
export async function listarContasTikTok(e: { token: string; appId: string; secret: string }): Promise<Resultado<ContaDisponivel[]>> {
  const r = await pedir(`${TIKTOK_API_URL}/oauth2/advertiser/get/?${new URLSearchParams({ app_id: e.appId, secret: e.secret })}`, {
    headers: { "Access-Token": e.token },
  });
  if (!r) return falha("Não foi possível falar com o TikTok (rede ou tempo esgotado).");
  const j = r.json as { code?: number; data?: { list?: Record<string, unknown>[] } } | null;
  if (j?.code !== 0 || !Array.isArray(j.data?.list)) return falha("O TikTok não devolveu a lista de anunciantes.");
  return {
    ok: true,
    valor: j.data.list.map((a) => ({ id: digitos(a.advertiser_id), nome: String(a.advertiser_name ?? "").trim() || `Anunciante ${digitos(a.advertiser_id)}` }))
      .filter((a) => a.id).slice(0, MAX_CONTAS),
  };
}

// ---------------------------------------------------------------------------------------------- Revogar

export type Revogacao = { revogado: boolean; detalhe: string };

/** Google: revoga o refresh token (e todos os acessos derivados dele). */
export async function revogarGoogle(refreshToken: string): Promise<Revogacao> {
  const r = await pedir(GOOGLE_REVOKE_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken }),
  });
  if (r?.status === 200) return { revogado: true, detalhe: "Acesso revogado no Google." };
  // Token que já estava vencido ou revogado: para o dono dá no mesmo, o acesso não existe mais.
  if (r && ehRevogacaoGoogle(r.json)) return { revogado: true, detalhe: "O acesso já estava revogado no Google." };
  if (r && (r.json as { error?: string } | null)?.error === "invalid_token") return { revogado: true, detalhe: "O acesso já estava revogado no Google." };
  return { revogado: false, detalhe: "Não foi possível revogar no Google; remova o acesso em myaccount.google.com/permissions." };
}

/** Meta: DELETE /me/permissions desfaz a autorização do app para aquela pessoa. */
export async function revogarMeta(e: { token: string; appSecret: string }): Promise<Revogacao> {
  const r = await pedir(`${META_GRAPH_URL}/${META_VERSAO}/me/permissions?${new URLSearchParams({ appsecret_proof: provaDoApp(e.token, e.appSecret) })}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${e.token}` },
  });
  if (r?.status === 200 && (r.json as { success?: boolean } | null)?.success) return { revogado: true, detalhe: "Acesso revogado na Meta." };
  if (r && ehRevogacaoMeta(r.json)) return { revogado: true, detalhe: "O acesso já estava vencido ou revogado na Meta." };
  return { revogado: false, detalhe: "Não foi possível revogar na Meta; remova a JUDITE em facebook.com/settings (Integrações comerciais)." };
}

/** Dias inteiros até o token vencer (negativo = já venceu). null quando não há validade conhecida. */
export function diasAteVencer(expiraEm: unknown, agora: Date = new Date()): number | null {
  if (typeof expiraEm !== "string") return null;
  const t = new Date(expiraEm).getTime();
  return Number.isFinite(t) ? Math.floor((t - agora.getTime()) / 864e5) : null;
}
/** Avisar com esta antecedência. */
export const DIAS_DE_AVISO = 7;

/** A conta pedida precisa estar na lista que a plataforma devolveu no login: ninguém escolhe conta "no chute". */
export function escolherEntre(disponiveis: unknown, id: string): ContaDisponivel | null {
  if (!Array.isArray(disponiveis)) return null;
  const achada = disponiveis.find((c): c is ContaDisponivel => Boolean(c) && typeof c === "object" && (c as { id?: unknown }).id === id);
  return achada && typeof achada.nome === "string" ? achada : null;
}

export type PedidoDeRevogacao = {
  provedor: "google_ads" | "google_presenca" | "meta" | "tiktok";
  segredos: Record<string, string | undefined>;
  dados: Record<string, unknown>;
  /** Chave secreta do app da Meta, quando o token veio do login pelo app da JUDITE. */
  segredoDoAppMeta: string | null;
  /** A outra conexão do Google (Ads ou Presença) ainda usa a mesma autorização? */
  outraConexaoGoogleAtiva: boolean;
};

/** Revoga o acesso na própria plataforma, quando dá. Os tokens são apagados da JUDITE em qualquer caso. */
export async function revogarNaPlataforma(e: PedidoDeRevogacao): Promise<Revogacao> {
  if (e.provedor === "google_ads" || e.provedor === "google_presenca") {
    if (!e.segredos.refresh_token) return { revogado: false, detalhe: "Não havia autorização do Google para revogar." };
    // No Google, revogar um token derruba a autorização inteira daquele e-mail para o app.
    if (e.outraConexaoGoogleAtiva) {
      return { revogado: false, detalhe: "O acesso no Google foi mantido porque a outra conexão do Google ainda usa a mesma autorização. Para revogar tudo, desconecte as duas." };
    }
    return revogarGoogle(e.segredos.refresh_token);
  }
  if (e.provedor === "meta") {
    if (!e.segredos.token) return { revogado: false, detalhe: "Não havia token da Meta para revogar." };
    if (e.dados.modo !== "login" || !e.segredoDoAppMeta) {
      return { revogado: false, detalhe: "O token de usuário do sistema não é revogado por aqui; apague-o no Gerenciador de Negócios, se quiser." };
    }
    return revogarMeta({ token: e.segredos.token, appSecret: e.segredoDoAppMeta });
  }
  return { revogado: false, detalhe: "O TikTok não é revogado por aqui; remova o app em ads.tiktok.com, se quiser." };
}
