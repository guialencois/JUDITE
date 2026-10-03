/**
 * Gerenciador: campanhas com ligar/desligar e orçamento diário, mais o histórico de ações.
 * Só dono e admin podem mudar campanhas; membros apenas veem.
 */

import { TabelaCampanhas, type LinhaCampanhaTabela } from "@/components/trafego/TabelaCampanhas";
import { podeAgir } from "@/lib/trafego/acesso";
import { brl, derivar, somar } from "@/lib/trafego/metricas";
import { dia, metricaDoBanco, NOME_PLATAFORMA, type LinhaMetrica, type Plataforma } from "@/lib/trafego/tipos";
import { carregarWorkspace } from "../../carregar";

export const dynamic = "force-dynamic";

const STATUS_COR: Record<string, string> = {
  aplicada: "text-emerald-400",
  erro: "text-rose-400",
  aguardando_aprovacao: "text-amber-400",
};

export default async function PaginaGerenciador(props: PageProps<"/painel/[workspaceId]/trafego/gerenciador">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const filtros = await props.searchParams;
  const dias = [7, 14, 30, 60].includes(Number(filtros.dias)) ? Number(filtros.dias) : 30;
  const de = dia(-dias);
  const ate = dia(-1);

  const [{ data: campanhas }, { data: metricas }, { data: acoes }, { data: cfg }] = await Promise.all([
    supabase.from("trafego_campanhas").select("*").eq("workspace_id", workspace.id).order("nome"),
    supabase.from("trafego_metricas_dia").select("*").eq("workspace_id", workspace.id).gte("data", de).lte("data", ate),
    supabase.from("trafego_acoes").select("*").eq("workspace_id", workspace.id).order("criado_em", { ascending: false }).limit(20),
    supabase.from("trafego_config").select("valor").eq("workspace_id", workspace.id).eq("chave", "custos_percent").maybeSingle(),
  ]);
  const custos = Number(cfg?.valor ?? 25);

  const porCampanha = new Map<string, LinhaMetrica[]>();
  for (const r of metricas ?? []) {
    const linha = metricaDoBanco(r);
    const chave = linha.plataforma + "|" + linha.campanhaId;
    porCampanha.set(chave, [...(porCampanha.get(chave) ?? []), linha]);
  }

  const linhas: LinhaCampanhaTabela[] = (campanhas ?? []).map((c) => {
    const totais = somar(porCampanha.get(c.plataforma + "|" + c.campanha_id) ?? []);
    const d = derivar(totais, custos);
    return {
      plataforma: c.plataforma as Plataforma,
      campanhaId: c.campanha_id,
      nome: c.nome || c.campanha_id,
      status: c.status,
      orcamentoDiario: c.orcamento_diario === null ? null : Number(c.orcamento_diario),
      gasto: totais.gasto,
      impressoes: totais.impressoes,
      cliques: totais.cliques,
      ctr: d.ctr, cpc: d.cpc,
      compras: totais.compras, cpa: d.cpa,
      receita: totais.receita, roas: d.roas,
    };
  });

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <header className="mb-5">
        <h1 className="font-serif text-3xl text-zinc-100">Gerenciador</h1>
        <p className="text-xs text-zinc-500">
          Métricas dos últimos {dias} dias.{" "}
          {podeAgir(papel) ? "As ações valem na conta de anúncios na hora." : "Seu papel é de leitura: só dono ou admin mudam campanhas."}
        </p>
      </header>

      <TabelaCampanhas workspaceId={workspace.id} podeAgir={podeAgir(papel)} linhas={linhas} />

      <h2 className="mb-3 mt-6 font-serif text-lg text-zinc-100">Histórico de ações</h2>
      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-2 pr-2 font-medium">Quando</th>
              <th className="py-2 pr-2 font-medium">Plataforma</th>
              <th className="py-2 pr-2 font-medium">Entidade</th>
              <th className="py-2 pr-2 font-medium">Ação</th>
              <th className="py-2 pr-2 font-medium">Mudança</th>
              <th className="py-2 font-medium">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {(acoes ?? []).map((a) => (
              <tr key={a.id} className="border-t border-zinc-800">
                <td className="py-2 pr-2 text-zinc-400">{new Date(a.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td className="py-2 pr-2 text-zinc-400">{NOME_PLATAFORMA[a.plataforma as Plataforma] ?? a.plataforma}</td>
                <td className="max-w-[220px] truncate py-2 pr-2 text-zinc-300">{a.entidade_nome ?? a.entidade_id}</td>
                <td className="py-2 pr-2 text-zinc-300">{a.acao}</td>
                <td className="py-2 pr-2 tabular-nums text-zinc-400">
                  {a.acao === "definir_orcamento"
                    ? brl(a.valor_antes === null ? null : Number(a.valor_antes)) + " para " + brl(Number(a.valor_depois ?? 0))
                    : (a.valor_antes ?? "-") + " para " + (a.valor_depois ?? "-")}
                </td>
                <td className={"py-2 " + (STATUS_COR[a.status] ?? "text-zinc-400")}>{a.status}</td>
              </tr>
            ))}
            {!(acoes ?? []).length && (
              <tr><td colSpan={6} className="py-6 text-center text-sm text-zinc-500">Nada mudado pelo painel ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
