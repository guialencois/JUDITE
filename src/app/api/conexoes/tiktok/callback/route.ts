/**
 * GET /api/conexoes/tiktok/callback
 * Volta do TikTok: confere o "state", troca o auth_code pelo access token, guarda o token
 * CRIPTOGRAFADO e lista os anunciantes autorizados (com nome) para o dono escolher.
 */

import { NextResponse, type NextRequest } from "next/server";
import { exigirDono } from "@/lib/conexoes/acesso";
import { appTikTok } from "@/lib/conexoes/app";
import { lerCookieOAuth, stateConfere } from "@/lib/conexoes/oauth";
import { listarContasTikTok, trocarCodigoTikTok } from "@/lib/conexoes/plataformas";
import { gravarConexao, lerConexao } from "@/lib/conexoes/segredos";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const salvo = lerCookieOAuth(req.cookies.get("judite_tiktok_oauth")?.value);
  if (!salvo) return NextResponse.redirect(new URL("/painel", req.url));
  const { state, workspaceId } = salvo;

  const voltar = (sufixo: string) => {
    const r = NextResponse.redirect(new URL(`/painel/${workspaceId}/conexoes?${sufixo}`, req.url));
    r.cookies.delete({ name: "judite_tiktok_oauth", path: "/api/conexoes/tiktok" });
    return r;
  };

  const params = req.nextUrl.searchParams;
  if (!stateConfere(params.get("state"), state)) return voltar("erro=tiktok-state");
  const authCode = params.get("auth_code") ?? params.get("code");
  if (!authCode) return voltar("erro=tiktok-cancelado");
  const dono = await exigirDono(workspaceId);
  if (!dono) return voltar("erro=so-dono");

  const db = createAdminClient();
  const { segredos } = await lerConexao(db, workspaceId, "tiktok");
  const app = appTikTok(segredos);
  if (!app) return voltar("erro=tiktok-app");

  const troca = await trocarCodigoTikTok({ authCode, appId: app.id, secret: app.segredo });
  if (!troca.ok) return voltar("erro=tiktok-token");

  // Os nomes vêm de oauth2/advertiser/get; se essa lista falhar, ficam só os IDs devolvidos na troca do código.
  const contas = await listarContasTikTok({ token: troca.valor.token, appId: app.id, secret: app.segredo });
  const disponiveis = contas.ok && contas.valor.length ? contas.valor : troca.valor.anunciantes.map((id) => ({ id, nome: `Anunciante ${id}` }));

  const { error } = await gravarConexao(db, workspaceId, "tiktok", dono.userId, {
    dados: {
      autorizado_em: new Date().toISOString(), app_origem: app.origem, precisa_reconectar: false, motivo_reconexao: null,
      anunciantes: disponiveis.map((c) => c.id), contas_disponiveis: disponiveis,
    },
    segredos: { access_token: troca.valor.token },
  });
  if (error) return voltar("erro=salvar");
  return voltar("aviso=tiktok-autorizado");
}
