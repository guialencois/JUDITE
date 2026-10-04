/**
 * GET /api/conexoes/tiktok/callback
 * Volta do TikTok: confere o "state", troca o auth_code pelo access token
 * e guarda o token CRIPTOGRAFADO na conexão do workspace, com a lista de contas autorizadas.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { TIKTOK_API_URL } from "@/lib/conexoes/config";
import { gravarConexao, lerConexao } from "@/lib/conexoes/segredos";
import { createAdminClient } from "@/lib/supabase/admin";
import { segredoConfere } from "@/lib/trafego/segredo";

export const runtime = "nodejs";

const cookieSchema = z.object({ state: z.string().min(16), workspaceId: z.uuid() });
const respostaSchema = z.object({
  code: z.number(),
  data: z.object({
    access_token: z.string().min(10),
    advertiser_ids: z.array(z.union([z.string(), z.number()]).transform(String)).default([]),
  }).optional(),
});

export async function GET(req: NextRequest) {
  const bruto = req.cookies.get("judite_tiktok_oauth")?.value;
  let salvo: z.infer<typeof cookieSchema> | null = null;
  try {
    const p = cookieSchema.safeParse(JSON.parse(bruto ?? "null"));
    salvo = p.success ? p.data : null;
  } catch {
    salvo = null;
  }
  if (!salvo) return NextResponse.redirect(new URL("/painel", req.url));
  const { state, workspaceId } = salvo;

  const voltar = (sufixo: string) => {
    const r = NextResponse.redirect(new URL(`/painel/${workspaceId}/conexoes?${sufixo}`, req.url));
    r.cookies.delete({ name: "judite_tiktok_oauth", path: "/api/conexoes/tiktok" });
    return r;
  };

  const params = req.nextUrl.searchParams;
  if (!segredoConfere(params.get("state"), state)) return voltar("erro=tiktok-state");
  const authCode = params.get("auth_code") ?? params.get("code");
  if (!authCode) return voltar("erro=tiktok-cancelado");
  const dono = await exigirDono(workspaceId);
  if (!dono) return voltar("erro=so-dono");

  const db = createAdminClient();
  const { segredos } = await lerConexao(db, workspaceId, "tiktok");
  if (!segredos.app_id || !segredos.secret) return voltar("erro=tiktok-app");

  const troca = await fetch(`${TIKTOK_API_URL}/oauth2/access_token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: segredos.app_id, secret: segredos.secret, auth_code: authCode }),
    cache: "no-store",
  }).catch(() => null);
  const resposta = respostaSchema.safeParse(await troca?.json().catch(() => null));
  if (!resposta.success || resposta.data.code !== 0 || !resposta.data.data) return voltar("erro=tiktok-token");

  const { error } = await gravarConexao(db, workspaceId, "tiktok", dono.userId, {
    dados: { autorizado_em: new Date().toISOString(), anunciantes: resposta.data.data.advertiser_ids.slice(0, 50) },
    segredos: { access_token: resposta.data.data.access_token },
  });
  if (error) return voltar("erro=salvar");
  return voltar("aviso=tiktok-autorizado");
}
