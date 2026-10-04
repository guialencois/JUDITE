/**
 * GET /api/diretor/cron — análise diária do Diretor (cron da Vercel, 1x por dia no plano Hobby).
 * Só aceita a chamada com o segredo do cron. Gera um relatório por workspace que tenha
 * alguma fonte de dados (conta de anúncios ou site). Sem ANTHROPIC_API_KEY, não faz nada.
 */

import { NextResponse } from "next/server";
import { iaConfigurada } from "@/lib/diretor/claude";
import { gerarRelatorio } from "@/lib/diretor/gerar";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehChamadaDoCron } from "@/lib/trafego/segredo";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Trava para a execução caber no tempo limite da função. */
const MAX_WORKSPACES = 10;

export async function GET(req: Request) {
  if (!ehChamadaDoCron(req)) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  if (!iaConfigurada()) return NextResponse.json({ pulado: "ANTHROPIC_API_KEY não configurada." });

  const db = createAdminClient();
  const [{ data: contas }, { data: sites }] = await Promise.all([
    db.from("trafego_contas").select("workspace_id").eq("ativo", true),
    db.from("sites").select("workspace_id"),
  ]);
  const workspaces = [...new Set([...(contas ?? []), ...(sites ?? [])].map((l) => l.workspace_id as string))].slice(0, MAX_WORKSPACES);

  const resultados = [];
  for (const id of workspaces) {
    const relatorio = await gerarRelatorio(db, id, "cron", null);
    resultados.push({ workspaceId: id, relatorio });
  }
  return NextResponse.json({ resultados });
}
