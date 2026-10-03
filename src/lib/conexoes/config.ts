/**
 * Configuração das conexões nativas (só servidor).
 *
 * Nível da agência (variáveis de ambiente, valem para todos os workspaces):
 *   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 * Nível do workspace (tabela conexoes, tokens criptografados):
 *   Google: refresh token da conta autorizada + ID do cliente
 *   Meta:   token do usuário do sistema + ID da conta de anúncios
 */

import { headers } from "next/headers";

export const GOOGLE_ESCOPO = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const META_GRAPH_URL = "https://graph.facebook.com";

export function googleAppConfigurado() {
  return {
    developerToken: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    oauth: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  };
}

/** Endereço público do site. Use SITE_URL fixo em produção para o retorno do Google bater sempre. */
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
