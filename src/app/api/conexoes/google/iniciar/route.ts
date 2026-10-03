/**
 * GET /api/conexoes/google/iniciar?workspaceId=...
 * Leva o dono do workspace para a tela de autorização do Google.
 * O "state" aleatório fica num cookie protegido e é conferido na volta (proteção contra CSRF).
 */

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { GOOGLE_AUTH_URL, GOOGLE_ESCOPO, googleRetorno, urlDoSite } from "@/lib/conexoes/config";
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
  const { segredos } = await lerConexao(createAdminClient(), workspaceId, "google_ads");
  const clientId = segredos.client_id;
  if (!clientId || !segredos.client_secret) return voltar("google-app");

  const state = randomBytes(24).toString("base64url");
  const site = await urlDoSite();
  const destino = new URL(GOOGLE_AUTH_URL);
  destino.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRetorno(site),
    response_type: "code",
    scope: GOOGLE_ESCOPO,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();

  const resposta = NextResponse.redirect(destino);
  resposta.cookies.set("judite_google_oauth", JSON.stringify({ state, workspaceId }), {
    httpOnly: true,
    secure: site.startsWith("https://"),
    sameSite: "lax",
    path: "/api/conexoes/google",
    maxAge: 600,
  });
  return resposta;
}
