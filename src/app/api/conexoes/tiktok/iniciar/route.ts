/**
 * GET /api/conexoes/tiktok/iniciar?workspaceId=...
 * Leva o dono do workspace para a tela de autorização do TikTok for Business.
 * O "state" aleatório fica num cookie protegido e é conferido na volta (proteção contra CSRF).
 */

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { TIKTOK_AUTH_URL, tiktokRetorno, urlDoSite } from "@/lib/conexoes/config";
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
  if (!segredos.app_id || !segredos.secret) return voltar("tiktok-app");

  const state = randomBytes(24).toString("base64url");
  const site = await urlDoSite();
  const destino = new URL(TIKTOK_AUTH_URL);
  destino.search = new URLSearchParams({
    app_id: segredos.app_id,
    state,
    redirect_uri: tiktokRetorno(site),
  }).toString();

  const resposta = NextResponse.redirect(destino);
  resposta.cookies.set("judite_tiktok_oauth", JSON.stringify({ state, workspaceId }), {
    httpOnly: true,
    secure: site.startsWith("https://"),
    sameSite: "lax",
    path: "/api/conexoes/tiktok",
    maxAge: 600,
  });
  return resposta;
}
