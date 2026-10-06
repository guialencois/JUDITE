/**
 * GET /api/conexoes/google/iniciar?workspaceId=...&alvo=ads|presenca
 * Leva o dono do workspace para a tela de autorização do Google (OAuth 2.0 com PKCE).
 * alvo=ads (padrão) pede só o Google Ads; alvo=presenca pede Perfil da Empresa + Search Console.
 * Os dois usam o mesmo app OAuth, mas guardam autorizações separadas, cada uma só com os seus escopos.
 * O "state" e o verificador PKCE ficam num cookie httpOnly e são conferidos na volta.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { appGoogle } from "@/lib/conexoes/app";
import { GOOGLE_AUTH_URL, GOOGLE_ESCOPO, googleRetorno, urlDoSite } from "@/lib/conexoes/config";
import { novoPedidoOAuth, opcoesDoCookie } from "@/lib/conexoes/oauth";
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
  // Autorização nova usa o app da plataforma, quando existe; senão, o app que o workspace salvou.
  const app = appGoogle(segredos);
  if (!app) return voltar("google-app");

  const pedido = novoPedidoOAuth();
  const site = await urlDoSite();
  const destino = new URL(GOOGLE_AUTH_URL);
  destino.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: googleRetorno(site),
    response_type: "code",
    // Escopo mínimo: cada autorização pede só o que usa.
    scope: alvo === "presenca" ? ESCOPOS_PRESENCA.join(" ") : GOOGLE_ESCOPO,
    access_type: "offline",
    prompt: "consent",
    state: pedido.state,
    code_challenge: pedido.desafio,
    code_challenge_method: "S256",
  }).toString();

  const resposta = NextResponse.redirect(destino);
  resposta.cookies.set(
    "judite_google_oauth",
    JSON.stringify({ state: pedido.state, verificador: pedido.verificador, workspaceId, alvo }),
    opcoesDoCookie(site, "/api/conexoes/google"),
  );
  return resposta;
}
