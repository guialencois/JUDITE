/**
 * GET /api/conexoes/meta/iniciar?workspaceId=...
 * Leva o dono do workspace para o Login do Facebook (fluxo manual oficial), com o app da JUDITE.
 * Pede só as permissões de anúncios. O "state" fica num cookie httpOnly e é conferido na volta.
 * (O diálogo da Meta não tem PKCE; a proteção é o state + a chave secreta do app na troca do código.)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { appMeta } from "@/lib/conexoes/app";
import { META_DIALOGO_URL, META_ESCOPOS, META_VERSAO, metaRetorno, urlDoSite } from "@/lib/conexoes/config";
import { novoPedidoOAuth, opcoesDoCookie } from "@/lib/conexoes/oauth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!z.uuid().safeParse(workspaceId).success) {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  const voltar = (erro: string) =>
    NextResponse.redirect(new URL(`/painel/${workspaceId}/conexoes?erro=${erro}`, req.url));

  if (!(await exigirDono(workspaceId))) return voltar("so-dono");
  const app = appMeta();
  if (!app) return voltar("meta-app");

  const pedido = novoPedidoOAuth();
  const site = await urlDoSite();
  const destino = new URL(`${META_DIALOGO_URL}/${META_VERSAO}/dialog/oauth`);
  destino.search = new URLSearchParams({
    client_id: app.id,
    redirect_uri: metaRetorno(site),
    state: pedido.state,
    response_type: "code",
    scope: META_ESCOPOS.join(","),
  }).toString();

  const resposta = NextResponse.redirect(destino);
  resposta.cookies.set("judite_meta_oauth", JSON.stringify({ state: pedido.state, workspaceId }), opcoesDoCookie(site, "/api/conexoes/meta"));
  return resposta;
}
