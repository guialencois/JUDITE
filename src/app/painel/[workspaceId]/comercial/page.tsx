/**
 * Comercial e Budget & ROI: metas do mês, vendas fechadas no WhatsApp (registradas pela equipe),
 * faturamento, ROAS real (vendas registradas ÷ gasto em anúncios), CAC, ticket médio e desempenho por produto.
 * Nenhum número é estimado: sem venda registrada ou sem gasto sincronizado, a conta aparece como "-".
 */

import Link from "next/link";
import { Anel } from "@/components/comercial/Anel";
import {
  agruparVendas, META_E_TETO, ORIGENS, progressoDasMetas, resumir, ROTULO_META, type LinhaGrupo, type MetricaMeta, type Venda,
} from "@/lib/comercial/contas";
import { podeAgir } from "@/lib/trafego/acesso";
import { brl, inteiro, multiplicador, percent } from "@/lib/trafego/metricas";
import { hojeEmBrasilia, lerLimites, limitesDoMes, mesValido, mesVizinho, nomeDoMes } from "@/lib/trafego/mes";
import { NOME_PLATAFORMA, type Plataforma } from "@/lib/trafego/tipos";
import { carregarWorkspace } from "../carregar";
import { apagarVenda, registrarVenda, salvarMetas } from "./actions";

export const dynamic = "force-dynamic";

const ERROS: Record<string, string> = {
  venda: "Não foi possível registrar a venda. Confira a data, o produto e o valor.",
  "venda-futura": "A data da venda não pode ser no futuro.",
  apagar: "Não foi possível apagar. Só o dono ou um admin podem apagar vendas.",
  metas: "Não foi possível salvar as metas. Confira os valores (só números).",
};
const AVISOS: Record<string, string> = {
  venda: "Venda registrada.",
  apagada: "Venda apagada.",
  metas: "Metas do mês salvas.",
};
const METRICAS: MetricaMeta[] = ["faturamento", "investimento", "compras", "roas", "cpa"];

const campo = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";
const cartao = "rounded-xl border border-zinc-800 bg-zinc-900/60 p-4";

function formatar(metrica: MetricaMeta, v: number | null): string {
  if (metrica === "roas") return multiplicador(v);
  if (metrica === "compras") return inteiro(v);
  return brl(v);
}

function TabelaGrupo({ titulo, coluna, linhas }: { titulo: string; coluna: string; linhas: LinhaGrupo[] }) {
  return (
    <div className={cartao}>
      <h2 className="mb-3 font-serif text-lg">{titulo}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500">
            <th className="py-1 pr-2 font-medium">{coluna}</th>
            <th className="py-1 pr-2 text-right font-medium">Vendas</th>
            <th className="py-1 pr-2 text-right font-medium">Pessoas</th>
            <th className="py-1 pr-2 text-right font-medium">Faturamento</th>
            <th className="py-1 pr-2 text-right font-medium">Ticket</th>
            <th className="py-1 text-right font-medium">Parte</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-t border-zinc-800">
              <td className="max-w-[220px] truncate py-1.5 pr-2 text-zinc-300">{l.rotulo}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{inteiro(l.vendas)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{inteiro(l.pessoas)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-400">{brl(l.faturamento)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{brl(l.ticketMedio)}</td>
              <td className="py-1.5 text-right tabular-nums text-zinc-400">{percent(l.parte, 0)}</td>
            </tr>
          ))}
          {!linhas.length && (
            <tr><td colSpan={6} className="py-4 text-center text-zinc-500">Nenhuma venda registrada no mês.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function ComercialPage(props: PageProps<"/painel/[workspaceId]/comercial">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const gestor = podeAgir(papel);
  const params = await props.searchParams;
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;
  const aviso = typeof params.aviso === "string" ? AVISOS[params.aviso] : undefined;

  const hoje = hojeEmBrasilia();
  const mesAtual = hoje.slice(0, 7);
  const mes = mesValido(params.mes) && params.mes <= mesAtual ? params.mes : mesAtual;
  const { inicio, fim } = limitesDoMes(mes);
  const base = `/painel/${workspace.id}/comercial`;

  const [{ data: vendasBrutas }, { data: metasBrutas }, { data: gastos }, { data: cfg }, { data: campanhas }] = await Promise.all([
    supabase.from("trafego_vendas").select("id, data, produto, pessoas, valor, origem, campanha_id, observacao")
      .eq("workspace_id", workspace.id).gte("data", inicio).lte("data", fim).order("data", { ascending: false }).order("criado_em", { ascending: false }).limit(5000),
    supabase.from("trafego_metas").select("metrica, alvo").eq("workspace_id", workspace.id).eq("mes", inicio),
    supabase.from("trafego_metricas_dia").select("gasto").eq("workspace_id", workspace.id).gte("data", inicio).lte("data", fim).limit(50000),
    supabase.from("trafego_config").select("chave, valor").eq("workspace_id", workspace.id),
    supabase.from("trafego_campanhas").select("plataforma, campanha_id, nome").eq("workspace_id", workspace.id).order("nome"),
  ]);

  const vendas: Venda[] = (vendasBrutas ?? []).map((v) => ({
    id: v.id as string, data: v.data as string, produto: v.produto as string, pessoas: Number(v.pessoas), valor: Number(v.valor),
    origem: (v.origem as string | null) ?? null, campanha_id: (v.campanha_id as string | null) ?? null, observacao: (v.observacao as string | null) ?? null,
  }));
  const gasto = (gastos ?? []).reduce((s, l) => s + Number(l.gasto ?? 0), 0);
  const resumo = resumir(vendas, gasto);
  const metas = (metasBrutas ?? []).map((m) => ({ metrica: m.metrica as MetricaMeta, alvo: Number(m.alvo) }));
  const progresso = progressoDasMetas(metas, resumo, gasto);
  const limites = lerLimites(cfg);
  const usoDoMes = limites.mensalMax > 0 ? gasto / limites.mensalMax : null;
  const nomeCampanha = new Map((campanhas ?? []).map((c) => [c.campanha_id as string, (c.nome as string) || (c.campanha_id as string)]));

  const cartoes = [
    { rotulo: "Faturamento (vendas registradas)", valor: brl(resumo.faturamento) },
    { rotulo: "Vendas", valor: inteiro(resumo.vendas) },
    { rotulo: "Ticket médio", valor: brl(resumo.ticketMedio) },
    { rotulo: "Gasto em anúncios", valor: brl(gasto) },
    { rotulo: "ROAS real", valor: multiplicador(resumo.roasReal) },
    { rotulo: "CAC (custo por venda)", valor: brl(resumo.cac) },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Comercial</h1>
          <p className="text-xs text-zinc-500">Vendas fechadas e retorno real dos anúncios em {nomeDoMes(mes)}.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link href={{ pathname: base, query: { mes: mesVizinho(mes, -1) } }} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-zinc-400">← mês anterior</Link>
          <span className="rounded-lg border border-amber-400 px-2.5 py-1 capitalize text-amber-400">{nomeDoMes(mes)}</span>
          {mes < mesAtual && (
            <Link href={{ pathname: base, query: { mes: mesVizinho(mes, 1) } }} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-zinc-400">mês seguinte →</Link>
          )}
        </div>
      </header>

      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</p>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {cartoes.map((c) => (
          <div key={c.rotulo} className={cartao}>
            <p className="text-xs text-zinc-500">{c.rotulo}</p>
            <p className="mt-1 truncate text-xl tabular-nums text-zinc-100">{c.valor}</p>
          </div>
        ))}
      </section>
      <p className="text-xs text-zinc-500">
        ROAS real = faturamento das vendas registradas ÷ gasto em anúncios sincronizado. CAC = gasto ÷ número de vendas.
        Sem gasto sincronizado ou sem vendas no mês, a conta aparece como &quot;-&quot;.
      </p>

      <section className={cartao}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg">Orçamento mensal de anúncios</h2>
          <p className="text-sm tabular-nums text-zinc-300">{brl(gasto)} de {brl(limites.mensalMax)} {usoDoMes !== null && <span className="text-zinc-500">({percent(usoDoMes, 0)})</span>}</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800" role="img" aria-label="Uso do orçamento mensal">
          <div
            className={"h-full rounded-full " + ((usoDoMes ?? 0) >= 1 ? "bg-rose-400" : (usoDoMes ?? 0) >= 0.8 ? "bg-amber-400" : "bg-emerald-400")}
            style={{ width: `${Math.min((usoDoMes ?? 0) * 100, 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          O limite é definido em Visão geral → Limites da IA. Qualquer aumento de verba ou ativação de campanha que faça o mês passar
          desse valor fica aguardando a sua aprovação.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-lg">Metas de {nomeDoMes(mes)}</h2>
        {progresso.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {progresso.map((p) => (
              <Anel
                key={p.metrica}
                rotulo={ROTULO_META[p.metrica]}
                atual={formatar(p.metrica, p.atual)}
                alvo={formatar(p.metrica, p.alvo)}
                proporcao={p.proporcao}
                atingida={p.atingida}
                teto={META_E_TETO[p.metrica]}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Nenhuma meta definida para este mês.</p>
        )}
        {gestor && (
          <details className="rounded-xl border border-zinc-800 p-4 text-sm">
            <summary className="cursor-pointer text-zinc-300">Definir metas do mês</summary>
            <form action={salvarMetas} className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="mes" value={mes} />
              {METRICAS.map((m) => (
                <label key={m} className="space-y-1 text-xs text-zinc-400">
                  <span className="block">{ROTULO_META[m]}{m === "roas" ? " (ex.: 4)" : m === "compras" ? " (quantidade)" : " (R$)"}</span>
                  <input
                    name={m} type="number" min={0} step="0.01" className={campo}
                    defaultValue={metas.find((x) => x.metrica === m)?.alvo ?? ""}
                  />
                </label>
              ))}
              <div className="sm:col-span-3 lg:col-span-5">
                <button className={botao}>Salvar metas</button>
                <span className="ml-3 text-xs text-zinc-500">Deixe vazio para não ter meta nessa métrica.</span>
              </div>
            </form>
          </details>
        )}
      </section>

      <section className={cartao}>
        <h2 className="mb-3 font-serif text-lg">Registrar venda do WhatsApp</h2>
        <form action={registrarVenda} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <label className="space-y-1 text-xs text-zinc-400">Data
            <input name="data" type="date" required defaultValue={mes === mesAtual ? hoje : fim} max={hoje} className={campo} />
          </label>
          <label className="space-y-1 text-xs text-zinc-400 lg:col-span-2">Produto
            <input name="produto" required maxLength={120} placeholder="O que foi vendido" className={campo} />
          </label>
          <label className="space-y-1 text-xs text-zinc-400">Pessoas
            <input name="pessoas" type="number" required min={1} max={1000} step={1} defaultValue={1} className={campo} />
          </label>
          <label className="space-y-1 text-xs text-zinc-400">Valor total (R$)
            <input name="valor" type="number" required min={0} step="0.01" className={campo} />
          </label>
          <label className="space-y-1 text-xs text-zinc-400">De onde veio o cliente
            <select name="origem" defaultValue="" className={campo}>
              <option value="">Não sei</option>
              {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-400 lg:col-span-2">Campanha (se souber)
            <select name="campanhaId" defaultValue="" className={campo}>
              <option value="">Nenhuma / não sei</option>
              {(campanhas ?? []).map((c) => (
                <option key={c.plataforma + c.campanha_id} value={c.campanha_id as string}>
                  {(c.nome as string) || (c.campanha_id as string)} · {NOME_PLATAFORMA[c.plataforma as Plataforma] ?? c.plataforma}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-400 sm:col-span-2 lg:col-span-3">Observação (opcional)
            <input name="observacao" maxLength={500} className={campo} />
          </label>
          <div className="flex items-end">
            <button className={botao}>Registrar venda</button>
          </div>
        </form>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <TabelaGrupo titulo="Desempenho por produto" coluna="Produto" linhas={agruparVendas(vendas, (v) => v.produto)} />
        <TabelaGrupo titulo="De onde vieram as vendas" coluna="Origem" linhas={agruparVendas(vendas, (v) => v.origem)} />
      </section>

      <section className={cartao}>
        <h2 className="mb-3 font-serif text-lg">Vendas do mês</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-2 font-medium">Data</th>
                <th className="py-1 pr-2 font-medium">Produto</th>
                <th className="py-1 pr-2 text-right font-medium">Pessoas</th>
                <th className="py-1 pr-2 text-right font-medium">Valor</th>
                <th className="py-1 pr-2 font-medium">Origem</th>
                <th className="py-1 pr-2 font-medium">Campanha</th>
                <th className="py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {vendas.map((v) => (
                <tr key={v.id} className="border-t border-zinc-800">
                  <td className="py-1.5 pr-2 text-zinc-400">{v.data.split("-").reverse().join("/")}</td>
                  <td className="max-w-[240px] truncate py-1.5 pr-2 text-zinc-200" title={v.observacao ?? undefined}>{v.produto}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{inteiro(v.pessoas)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-400">{brl(v.valor)}</td>
                  <td className="py-1.5 pr-2 text-zinc-400">{v.origem ?? "-"}</td>
                  <td className="max-w-[200px] truncate py-1.5 pr-2 text-zinc-400">{v.campanha_id ? nomeCampanha.get(v.campanha_id) ?? v.campanha_id : "-"}</td>
                  <td className="py-1.5 text-right">
                    {gestor && (
                      <form action={apagarVenda}>
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="vendaId" value={v.id} />
                        <input type="hidden" name="mes" value={mes} />
                        <button className="text-xs text-zinc-500 hover:text-rose-400">apagar</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {!vendas.length && (
                <tr><td colSpan={7} className="py-6 text-center text-zinc-500">Nenhuma venda registrada em {nomeDoMes(mes)}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
