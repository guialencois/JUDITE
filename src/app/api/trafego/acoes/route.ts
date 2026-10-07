/**
 * POST /api/trafego/acoes
 * Pausa, ativa ou muda o orçamento diário de uma campanha DE VERDADE.
 * Mexe em dinheiro, então, nesta ordem:
 *   1. valida o pedido (zod);
 *   2. só dono ou admin do workspace (ou a automação, com o segredo do cron);
 *   3. o resto (freios, aprovação, histórico) fica em src/lib/trafego/executar.ts,
 *      que é o único caminho para mudar campanhas.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";
import { executarAcao } from "@/lib/trafego/executar";
import { ehChamadaDoCron } from "@/lib/trafego/segredo";

export const runtime = "nodejs";

const corpoSchema = z.object({
  workspaceId: z.uuid(),
  origem: z.enum(["painel", "automacao"]).default("painel"),
  plataforma: z.enum(["google_ads", "facebook", "tiktok"]),
  // Por enquanto só campanhas: elas são as únicas que a JUDITE sabe a que workspace pertencem.
  tipoEntidade: z.literal("campanha").default("campanha"),
  entidadeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  entidadeNome: z.string().max(200).optional(),
  acao: z.enum(["pausar", "ativar", "definir_orcamento"]),
  valorReais: z.number().positive().max(1_000_000).optional(),
  confirmado: z.boolean().default(false),
}).refine((p) => p.acao !== "definir_orcamento" || p.valorReais !== undefined);

export async function POST(req: Request) {
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  const p = parsed.data;

  // --- quem pode agir ---------------------------------------------------
  let usuarioId: string | null = null;
  if (p.origem === "automacao") {
    if (!ehChamadaDoCron(req)) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  } else {
    const acesso = await papelNoWorkspace(p.workspaceId);
    if (!acesso) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
    if (!podeAgir(acesso.papel)) {
      return NextResponse.json({ erro: "Só o dono ou um admin do workspace pode mudar campanhas." }, { status: 403 });
    }
    usuarioId = acesso.userId;
  }

  const r = await executarAcao(createAdminClient(), {
    workspaceId: p.workspaceId, origem: p.origem, usuarioId, plataforma: p.plataforma,
    entidadeId: p.entidadeId, entidadeNome: p.entidadeNome, acao: p.acao, valorReais: p.valorReais, confirmado: p.confirmado,
  });

  if (r.tipo === "aplicada") return NextResponse.json({ ok: true, acao: r.acao, valor: r.valor });
  if (r.tipo === "aguardando_aprovacao") {
    return NextResponse.json({ precisaAprovacao: true, motivo: r.motivo, valor: r.valor ?? null }, { status: 409 });
  }
  if (r.tipo === "recusada") return NextResponse.json({ erro: r.erro }, { status: r.http });
  return NextResponse.json({ erro: "A plataforma recusou a mudança. Veja o histórico de ações." }, { status: 502 });
}
