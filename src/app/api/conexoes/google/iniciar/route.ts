/**
 * GET /api/conexoes/google/iniciar?workspaceId=...&alvo=ads|presenca
 * Leva o dono do workspace para a tela de autorização do Google.
 * alvo=ads (padrão) pede o Google Ads; alvo=presenca pede Perfil da Empresa + Search Console.
 * Os dois usam o mesmo app OAuth do workspace, mas guardam autorizações separadas.
 * O "state" aleatório fica num cookie protegido e é conferido na volta (proteção contra CSRF).
 */

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { GOOGLE_AUTH_URL, GOOGLE_ESCOPO, googleRetorno, urlDoSite } from "@/lib/conexoes/config";
import { lerConexao } from "@/lib/conexoes/segredos";
import { ESCOPOS_PRESENCA } from "@/lib/presenca/google";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!z.uuid().safeParse(workspaceId).success) {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  const voltar = (erro: string) =>
    NextResponse.redirect(new URL(`/painel/${workspaceId}/conexoes?erro=${erro}`, req.url));

  const alvo = req.nextUrl.searchParams.get("alvo") === "presenca" ? "presenca" : "ads";

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
    scope: alvo === "presenca" ? ESCOPOS_PRESENCA.join(" ") : GOOGLE_ESCOPO,
    access_type: "offline",
    prompt: "consent",
    // Cada autorização fica só com os próprios escopos (menor privilégio): sem include_granted_scopes na presença.
    ...(alvo === "ads" ? { include_granted_scopes: "true" } : {}),
    state,
  }).toString();

  const resposta = NextResponse.redirect(destino);
  resposta.cookies.set("judite_google_oauth", JSON.stringify({ state, workspaceId, alvo }), {
    httpOnly: true,
    secure: site.startsWith("https://"),
    sameSite: "lax",
    path: "/api/conexoes/google",
    maxAge: 600,
  });
  return resposta;
}
