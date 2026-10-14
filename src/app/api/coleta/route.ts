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
  // Modo de teste (?judite_teste=1 no site): o evento é marcado e a rota explica o que aconteceu.
  x: z.literal(1).optional(),
});

/** Nome do evento gravado pelo modo de teste; fica fora das contas da aba Site. */
const NOME_TESTE = "judite_teste";

const vazio = () => new NextResponse(null, { status: 204 });

const MOTIVOS = {
  robo: "o navegador foi identificado como robô",
  invalido: "o pedido chegou em formato inválido",
  chave: "a chave (data-chave) não corresponde a nenhum site cadastrado na JUDITE; copie de novo o código na aba Site",
  dominio: "o pedido não veio do domínio cadastrado na aba Site",
  banco: "o banco de dados recusou a gravação",
} as const;

function pareceTeste(bruto: string): boolean {
  return /"x"\s*:\s*1\b/.test(bruto);
}

/** A Vercel manda a cidade codificada (ex.: "S%C3%A3o%20Lu%C3%ADs"); um valor malformado não pode derrubar a coleta. */
function cidadeLegivel(valor: string | null): string | null {
  if (!valor) return null;
  try {
    return decodeURIComponent(valor).slice(0, 80);
  } catch {
    return valor.slice(0, 80);
  }
}

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
  const bruto = await req.text();
  if (bruto.length > 4000) return vazio();
  const teste = pareceTeste(bruto);

  // Fora do modo de teste a rota nunca explica nada (204 sempre). No teste, devolve o motivo
  // para o dono do site enxergar o que falta; não revela nenhum dado do banco.
  const origemPedido = req.headers.get("origin");
  const responder = (motivo?: keyof typeof MOTIVOS) => {
    if (!teste) return vazio();
    return NextResponse.json(motivo ? { ok: false, motivo: MOTIVOS[motivo] } : { ok: true }, {
      headers: { "Access-Control-Allow-Origin": origemPedido ?? "*", Vary: "Origin", "Cache-Control": "no-store" },
    });
  };

  if (ROBOS.test(navegador)) return responder("robo");
  let json: unknown = null;
  try {
    json = JSON.parse(bruto);
  } catch {
    return responder("invalido");
  }
  const parsed = eventoSchema.safeParse(json);
  if (!parsed.success) return responder("invalido");
  const e = parsed.data;

  const db = createAdminClient();
  const { data: site } = await db.from("sites").select("id, workspace_id, dominio").eq("chave", e.k).maybeSingle();
  if (!site) return responder("chave");

  // Só aceita eventos vindos do domínio cadastrado (ou subdomínio dele).
  const deOnde = hostDe(req.headers.get("origin")) ?? hostDe(req.headers.get("referer"));
  const dominio = String(site.dominio);
  if (!deOnde || !(deOnde === dominio || deOnde.endsWith("." + dominio))) return responder("dominio");

  const referencia = hostDe(e.r);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const cidade = cidadeLegivel(req.headers.get("x-vercel-ip-city"));

  const { error } = await db.from("site_eventos").insert({
    site_id: site.id,
    workspace_id: site.workspace_id,
    tipo: e.x ? "evento" : e.t,
    nome: e.x ? NOME_TESTE : e.n === NOME_TESTE ? null : e.n,
    // "/index.html" e "/" são a mesma página.
    caminho: e.p.replace(/\/index\.html?$/i, "/"),
    origem: referencia && referencia !== dominio && !referencia.endsWith("." + dominio) ? referencia.slice(0, 120) : null,
    utm_source: e.u.utm_source ?? null,
    utm_medium: e.u.utm_medium ?? null,
    utm_campaign: e.u.utm_campaign ?? null,
    utm_content: e.u.utm_content ?? null,
    anuncio: e.a ?? null,
    dispositivo: e.w === 0 ? null : e.w < 768 ? "celular" : e.w < 1100 ? "tablet" : "computador",
    pais: req.headers.get("x-vercel-ip-country")?.slice(0, 2) ?? null,
    regiao: req.headers.get("x-vercel-ip-country-region")?.slice(0, 10) ?? null,
    cidade,
    visitante: codigoVisitante(String(site.id), ip, navegador),
  });
  if (error) {
    // Antes o erro sumia em silêncio; agora aparece nos logs da Vercel (sem dados do visitante).
    console.error("[coleta] falha ao gravar evento:", error.message);
    return responder("banco");
  }

  return responder();
}
