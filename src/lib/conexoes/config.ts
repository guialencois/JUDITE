/**
 * Configuração das conexões nativas (só servidor).
 *
 * Tudo é configurado pela página Conexões e fica na tabela conexoes (segredos criptografados):
 *   Google: developer token, ID e chave secreta do app OAuth, refresh token e ID do cliente
 *   Meta:   token do usuário do sistema e ID da conta de anúncios
 *   TikTok: ID e chave secreta do app, access token (OAuth) e ID do anunciante
 */

import { headers } from "next/headers";

export const GOOGLE_ESCOPO = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_ADS_URL = "https://googleads.googleapis.com";
/** Versão da Google Ads API. Conferida em 04/10/2026: v22 a v26 respondem; v26 é a mais nova. */
export const GOOGLE_ADS_VERSAO = "v26";
/** TikTok Marketing API. Conferida em 04/10/2026: a v1.3 responde. */
export const TIKTOK_API_URL = "https://business-api.tiktok.com/open_api/v1.3";
export const TIKTOK_AUTH_URL = "https://business-api.tiktok.com/portal/auth";
export const META_GRAPH_URL = "https://graph.facebook.com";
/** Diálogo de login da Meta (Facebook Login, fluxo manual). */
export const META_DIALOGO_URL = "https://www.facebook.com";
export const META_ESCOPOS = ["ads_read", "ads_management", "business_management"];
/** Versão da Graph/Marketing API. Conferida em 04/10/2026: v26.0 é a mais nova que responde. */
export const META_VERSAO = "v26.0";

/** O endereço do site está fixado por SITE_URL? Com ela, o redirect_uri do OAuth não depende do pedido. */
export const siteFixado = (): boolean => Boolean(process.env.SITE_URL?.trim());

/**
 * Endereço público do site. O redirect_uri do OAuth é sempre montado a partir daqui: com SITE_URL definida,
 * vale ela (recomendado em produção); sem ela, cai no endereço do próprio pedido, e as plataformas só aceitam
 * a volta se esse endereço estiver cadastrado nelas.
 */
export async function urlDoSite(): Promise<string> {
  if (siteFixado()) return String(process.env.SITE_URL).trim().replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const googleRetorno = (site: string) => `${site}/api/conexoes/google/callback`;
export const tiktokRetorno = (site: string) => `${site}/api/conexoes/tiktok/callback`;
export const metaRetorno = (site: string) => `${site}/api/conexoes/meta/callback`;

/** "411-071-3742" -> "4110713742" */
export const soDigitos = (v: string) => v.replace(/\D/g, "");
export const comTracos = (v: string) => (v.length === 10 ? `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}` : v);
