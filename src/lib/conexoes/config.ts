/**
 * Configuração das conexões nativas (só servidor).
 *
 * Tudo é configurado pela página Conexões e fica na tabela conexoes (segredos criptografados):
 *   Google: developer token, ID e chave secreta do app OAuth, refresh token e ID do cliente
 *   Meta:   token do usuário do sistema e ID da conta de anúncios
 */

import { headers } from "next/headers";

export const GOOGLE_ESCOPO = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_ADS_URL = "https://googleads.googleapis.com";
/** Versão da Google Ads API. Conferida em 04/10/2026: v22 a v26 respondem; v26 é a mais nova. */
export const GOOGLE_ADS_VERSAO = "v26";
export const META_GRAPH_URL = "https://graph.facebook.com";
/** Versão da Graph/Marketing API. Conferida em 04/10/2026: v26.0 é a mais nova que responde. */
export const META_VERSAO = "v26.0";

/** Endereço público do site, descoberto pelo próprio pedido (SITE_URL é opcional, para fixar um domínio). */
export async function urlDoSite(): Promise<string> {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const googleRetorno = (site: string) => `${site}/api/conexoes/google/callback`;

/** "411-071-3742" -> "4110713742" */
export const soDigitos = (v: string) => v.replace(/\D/g, "");
export const comTracos = (v: string) => (v.length === 10 ? `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}` : v);
