/**
 * GET /api/conexoes/google/callback
 * Volta do Google: confere o "state" (tempo constante), troca o código pelo refresh token usando o
 * verificador PKCE, guarda o token CRIPTOGRAFADO e, no Google Ads, lista as contas para o dono escolher.
 */

import { NextResponse, type NextRequest } from "next/server";
import { exigirDono } from "@/lib/conexoes/acesso";
import { appGoogle, developerTokenGoogle, mccPadraoGoogle } from "@/lib/conexoes/app";
import { googleRetorno, urlDoSite } from "@/lib/conexoes/config";
import { lerCookieOAuth, stateConfere } from "@/lib/conexoes/oauth";
import { listarContasGoogle, trocarCodigoGoogle } from "@/lib/conexoes/plataformas";
import { gravarConexao, lerConexao } from "@/lib/conexoes/segredos";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const salvo = lerCookieOAuth(req.cookies.get("judite_google_oauth")?.value);
  if (!salvo) return NextResponse.redirect(new URL("/painel", req.url));
  const { state, workspaceId, alvo, verificador } = salvo;

  const voltar = (sufixo: string) => {
    const r = NextResponse.redirect(new URL(`/painel/${workspaceId}/conexoes?${sufixo}`, req.url));
    r.cookies.delete({ name: "judite_google_oauth", path: "/api/conexoes/google" });
    return r;
  };
  const comMotivo = (codigo: string, motivo: string) => voltar(`erro=${codigo}&motivo=${encodeURIComponent(motivo.slice(0, 200))}`);

  const params = req.nextUrl.searchParams;
  if (!stateConfere(params.get("state"), state)) return voltar("erro=google-state");
  const code = params.get("code");
  if (!code) return voltar("erro=google-cancelado");
  const dono = await exigirDono(workspaceId);
  if (!dono) return voltar("erro=so-dono");

  const db = createAdminClient();
  const { segredos } = await lerConexao(db, workspaceId, "google_ads");
  const app = appGoogle(segredos);
  if (!app) return voltar("erro=google-app");

  const troca = await trocarCodigoGoogle({
    code, clientId: app.clientId, clientSecret: app.clientSecret, redirectUri: googleRetorno(await urlDoSite()), verificador,
  });
  if (!troca.ok) return comMotivo("google-token", troca.motivo);

  const base = { autorizado_em: new Date().toISOString(), app_origem: app.origem, precisa_reconectar: false, motivo_reconexao: null };

  if (alvo === "presenca") {
    const { error } = await gravarConexao(db, workspaceId, "google_presenca", dono.userId, {
      dados: base, segredos: { refresh_token: troca.valor.refreshToken },
    });
    return voltar(error ? "erro=salvar-presenca" : "aviso=presenca-autorizada");
  }

  // Google Ads: lista as contas que este e-mail alcança, para o dono escolher na tela.
  const developerToken = developerTokenGoogle(segredos);
  const contas = developerToken
    ? await listarContasGoogle({ accessToken: troca.valor.accessToken, developerToken, mccPadrao: mccPadraoGoogle() })
    : null;
  const { error } = await gravarConexao(db, workspaceId, "google_ads", dono.userId, {
    dados: { ...base, contas_disponiveis: contas?.ok ? contas.valor : [], aviso_contas: contas && !contas.ok ? contas.motivo : null },
    segredos: { refresh_token: troca.valor.refreshToken },
  });
  if (error) return voltar("erro=salvar");
  if (!developerToken) return voltar("aviso=google-sem-token");
  if (contas && !contas.ok) return comMotivo("google-contas", contas.motivo);
  return voltar(contas?.ok && contas.valor.length ? "aviso=google-escolher" : "aviso=google-sem-contas");
}
