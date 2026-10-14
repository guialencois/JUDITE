/**
 * GET /api/conexoes/tiktok/iniciar?workspaceId=...
 * Leva o dono do workspace para a tela de autorização do TikTok for Business.
 * O "state" aleatório fica num cookie protegido e é conferido na volta (proteção contra CSRF).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { appTikTok } from "@/lib/conexoes/app";
import { TIKTOK_AUTH_URL, tiktokRetorno, urlDoSite } from "@/lib/conexoes/config";
import { novoPedidoOAuth, opcoesDoCookie } from "@/lib/conexoes/oauth";
import { lerConexao } from "@/lib/conexoes/segredos";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!z.uuid().safeParse(workspaceId).success) {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  const voltar = (erro: string) =>
    NextResponse.redirect(new URL(`/painel/${workspaceId}/conexoes?erro=${erro}`, req.url));

  if (!(await exigirDono(workspaceId))) return voltar("so-dono");
  const { segredos } = await lerConexao(createAdminClient(), workspaceId, "tiktok");
  // Autorização nova usa o app da plataforma, quando existe; senão, o app que o workspace salvou.
  const app = appTikTok(segredos);
  if (!app) return voltar("tiktok-app");

  const { state } = novoPedidoOAuth();
  const site = await urlDoSite();
  const destino = new URL(TIKTOK_AUTH_URL);
  destino.search = new URLSearchParams({
    app_id: app.id,
    state,
    redirect_uri: tiktokRetorno(site),
  }).toString();

  const resposta = NextResponse.redirect(destino);
  resposta.cookies.set("judite_tiktok_oauth", JSON.stringify({ state, workspaceId }), opcoesDoCookie(site, "/api/conexoes/tiktok"));
  return resposta;
}
