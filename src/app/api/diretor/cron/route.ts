/**
 * GET /api/diretor/cron — análise diária do Diretor (cron da Vercel, 1x por dia no plano Hobby).
 * Só aceita a chamada com o segredo do cron. Gera um relatório por workspace que tenha
 * alguma fonte de dados (conta de anúncios ou site). Sem a chave da IA, o relatório é pulado.
 * Em seguida roda o ciclo da CMO (src/lib/cmo/ciclo.ts): monitora as campanhas ligadas e monta, no máximo, uma proposta
 * de campanha nova por workspace por dia (rascunho aguardando aprovação). O ciclo é idempotente e respeita o nível de autonomia.
 * Depois, roda a autonomia supervisionada nos workspaces em que o dono a ligou (desligada por padrão);
 * as regras da autonomia não usam IA e passam sempre pelos freios de orçamento.
 */

import { NextResponse } from "next/server";
import { cicloDiarioDoWorkspace } from "@/lib/cmo/servico";
import { rodarAutonomia } from "@/lib/diretor/autonomia";
import { iaConfigurada, mensagemSemChave } from "@/lib/ia";
import { gerarRelatorio } from "@/lib/diretor/gerar";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehChamadaDoCron } from "@/lib/trafego/segredo";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Trava para a execução caber no tempo limite da função. */
const MAX_WORKSPACES = 10;

export async function GET(req: Request) {
  if (!ehChamadaDoCron(req)) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const temIA = iaConfigurada();

  const db = createAdminClient();
  const [{ data: contas }, { data: sites }] = await Promise.all([
    db.from("trafego_contas").select("workspace_id").eq("ativo", true),
    db.from("sites").select("workspace_id"),
  ]);
  const workspaces = [...new Set([...(contas ?? []), ...(sites ?? [])].map((l) => l.workspace_id as string))].slice(0, MAX_WORKSPACES);

  const resultados = [];
  for (const id of workspaces) {
    const relatorio = temIA ? await gerarRelatorio(db, id, "cron", null) : { ok: false, motivo: mensagemSemChave() };
    // Ciclo da CMO: no máximo uma proposta por dia, só como rascunho para o dono avaliar (nada é criado nem gasto).
    const ciclo = await cicloDiarioDoWorkspace(db, id).catch(() => ({ rodou: false as const, motivo: "erro inesperado no ciclo da CMO" }));
    const proposta = !ciclo.rodou
      ? { ok: false, motivo: ciclo.motivo }
      : ciclo.proposta.ok ? { ok: true, nome: ciclo.proposta.nome } : { ok: false, motivo: ciclo.proposta.motivo };
    // Um erro na autonomia de um workspace não pode parar os outros.
    const autonomia = await rodarAutonomia(db, id).catch((e) => ({ erro: e instanceof Error ? e.message : "erro" }));
    resultados.push({ workspaceId: id, relatorio, proposta, autonomia });
  }
  return NextResponse.json({ resultados });
}
