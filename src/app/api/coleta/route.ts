/**
 * POST /api/coleta — recebe os eventos do rastreador (public/j.js) instalado no site.
 * Rota pública: só aceita sites cadastrados, vindos do próprio domínio, e nunca guarda IP.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { codigoVisitante } from "@/lib/site/visitante";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ROBOS = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp/i;
const texto = (max: number) => z.string().max(max).nullish().transform((v) => (v ? v : null));

const eventoSchema = z.object({
  k: z.string().regex(/^[a-f0-9]{32}$/),
  t: z.enum(["pageview", "whatsapp", "carrinho", "evento"]),
  n: texto(80),
  p: z.string().max(300).startsWith("/").default("/"),
  r: texto(500),
  u: z.object({
    utm_source: texto(100), utm_medium: texto(100), utm_campaign: texto(150), utm_content: texto(150),
  }).partial().default({}),
  a: z.enum(["google", "meta", "tiktok"]).nullish(),
  w: z.number().int().min(0).max(10000).default(0),
});

const vazio = () => new NextResponse(null, { status: 204 });

function hostDe(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const navegador = req.headers.get("user-agent") ?? "";
  if (ROBOS.test(navegador)) return vazio();

  const bruto = await req.text();
  if (bruto.length > 4000) return vazio();
  let json: unknown = null;
  try {
    json = JSON.parse(bruto);
  } catch {
    return vazio();
  }
  const parsed = eventoSchema.safeParse(json);
  if (!parsed.success) return vazio();
  const e = parsed.data;

  const db = createAdminClient();
  const { data: site } = await db.from("sites").select("id, workspace_id, dominio").eq("chave", e.k).maybeSingle();
  if (!site) return vazio();

  // Só aceita eventos vindos do domínio cadastrado (ou subdomínio dele).
  const deOnde = hostDe(req.headers.get("origin")) ?? hostDe(req.headers.get("referer"));
  const dominio = String(site.dominio);
  if (!deOnde || !(deOnde === dominio || deOnde.endsWith("." + dominio))) return vazio();

  const referencia = hostDe(e.r);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const cidade = req.headers.get("x-vercel-ip-city");

  await db.from("site_eventos").insert({
    site_id: site.id,
    workspace_id: site.workspace_id,
    tipo: e.t,
    nome: e.n,
    caminho: e.p,
    origem: referencia && referencia !== dominio && !referencia.endsWith("." + dominio) ? referencia.slice(0, 120) : null,
    utm_source: e.u.utm_source ?? null,
    utm_medium: e.u.utm_medium ?? null,
    utm_campaign: e.u.utm_campaign ?? null,
    utm_content: e.u.utm_content ?? null,
    anuncio: e.a ?? null,
    dispositivo: e.w === 0 ? null : e.w < 768 ? "celular" : e.w < 1100 ? "tablet" : "computador",
    pais: req.headers.get("x-vercel-ip-country")?.slice(0, 2) ?? null,
    regiao: req.headers.get("x-vercel-ip-country-region")?.slice(0, 10) ?? null,
    cidade: cidade ? decodeURIComponent(cidade).slice(0, 80) : null,
    visitante: codigoVisitante(String(site.id), ip, navegador),
  });

  return vazio();
}
