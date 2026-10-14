/**
 * GET /api/conexoes/meta/callback
 * Volta do Login do Facebook: confere o "state", troca o código por um token de longa duração,
 * guarda o token CRIPTOGRAFADO com a validade e lista as contas de anúncios para o dono escolher.
 */

import { NextResponse, type NextRequest } from "next/server";
import { exigirDono } from "@/lib/conexoes/acesso";
import { appMeta } from "@/lib/conexoes/app";
import { metaRetorno, urlDoSite } from "@/lib/conexoes/config";
import { lerCookieOAuth, stateConfere } from "@/lib/conexoes/oauth";
import { listarContasMeta, trocarCodigoMeta } from "@/lib/conexoes/plataformas";
import { gravarConexao, lerConexao } from "@/lib/conexoes/segredos";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const salvo = lerCookieOAuth(req.cookies.get("judite_meta_oauth")?.value);
  if (!salvo) return NextResponse.redirect(new URL("/painel", req.url));
  const { state, workspaceId } = salvo;

  const voltar = (sufixo: string) => {
    const r = NextResponse.redirect(new URL(`/painel/${workspaceId}/conexoes?${sufixo}`, req.url));
    r.cookies.delete({ name: "judite_meta_oauth", path: "/api/conexoes/meta" });
    return r;
  };
  const comMotivo = (codigo: string, motivo: string) => voltar(`erro=${codigo}&motivo=${encodeURIComponent(motivo.slice(0, 200))}`);

  const params = req.nextUrl.searchParams;
  if (!stateConfere(params.get("state"), state)) return voltar("erro=meta-state");
  const code = params.get("code");
  if (!code) return voltar("erro=meta-cancelado");
  const dono = await exigirDono(workspaceId);
  if (!dono) return voltar("erro=so-dono");
  const app = appMeta();
  if (!app) return voltar("erro=meta-app");

  const troca = await trocarCodigoMeta({ code, appId: app.id, appSecret: app.segredo, redirectUri: metaRetorno(await urlDoSite()) });
  if (!troca.ok) return comMotivo("meta-token", troca.motivo);

  const contas = await listarContasMeta({ token: troca.valor.token, appSecret: app.segredo });
  const db = createAdminClient();
  const { dados: antes } = await lerConexao(db, workspaceId, "meta");
  // A conta já escolhida só continua valendo se o novo login também alcança essa conta.
  const mantem = contas.ok && contas.valor.some((c) => c.id === antes.conta);
  const { error } = await gravarConexao(db, workspaceId, "meta", dono.userId, {
    dados: {
      ...(mantem ? {} : { conta: null, nome: null }),
      autorizado_em: new Date().toISOString(), app_origem: "plataforma", modo: "login", expira_em: troca.valor.expiraEm,
      precisa_reconectar: false, motivo_reconexao: null,
      contas_disponiveis: contas.ok ? contas.valor : [], aviso_contas: contas.ok ? null : contas.motivo,
    },
    segredos: { token: troca.valor.token },
  });
  if (error) return voltar("erro=salvar");
  if (!contas.ok) return comMotivo("meta-contas", contas.motivo);
  if (mantem) return voltar("aviso=meta-reconectada");
  return voltar(contas.valor.length ? "aviso=meta-escolher" : "aviso=meta-sem-contas");
}
