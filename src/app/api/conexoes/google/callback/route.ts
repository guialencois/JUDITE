/**
 * GET /api/conexoes/google/callback
 * Volta do Google: confere o "state", troca o código pelo refresh token
 * e guarda o token CRIPTOGRAFADO na conexão do workspace.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { GOOGLE_TOKEN_URL, googleRetorno, urlDoSite } from "@/lib/conexoes/config";
import { cifrar } from "@/lib/cripto";
import { createAdminClient } from "@/lib/supabase/admin";
import { segredoConfere } from "@/lib/trafego/segredo";

export const runtime = "nodejs";

const cookieSchema = z.object({ state: z.string().min(16), workspaceId: z.uuid() });

export async function GET(req: NextRequest) {
  const bruto = req.cookies.get("judite_google_oauth")?.value;
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
    r.cookies.delete({ name: "judite_google_oauth", path: "/api/conexoes/google" });
    return r;
  };

  const params = req.nextUrl.searchParams;
  if (!segredoConfere(params.get("state"), state)) return voltar("erro=google-state");
  const code = params.get("code");
  if (!code) return voltar("erro=google-cancelado");
  const dono = await exigirDono(workspaceId);
  if (!dono) return voltar("erro=so-dono");

  const site = await urlDoSite();
  const troca = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: googleRetorno(site),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const tokens = (await troca.json().catch(() => null)) as { refresh_token?: string } | null;
  if (!troca.ok || !tokens?.refresh_token) return voltar("erro=google-token");

  const db = createAdminClient();
  const { data: atual } = await db
    .from("conexoes")
    .select("dados")
    .eq("workspace_id", workspaceId)
    .eq("provedor", "google_ads")
    .maybeSingle();
  const dados: Record<string, unknown> = {
    ...((atual?.dados as Record<string, unknown>) ?? {}),
    autorizado_em: new Date().toISOString(),
  };

  const { error } = await db.from("conexoes").upsert({
    workspace_id: workspaceId,
    provedor: "google_ads",
    dados,
    segredo: cifrar({ refresh_token: tokens.refresh_token }),
    conectado_em: dados.cliente ? new Date().toISOString() : null,
    atualizado_em: new Date().toISOString(),
    atualizado_por: dono.userId,
  });
  if (error) return voltar("erro=salvar");
  return voltar("aviso=google-autorizado");
}
