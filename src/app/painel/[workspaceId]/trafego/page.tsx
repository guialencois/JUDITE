/**
 * Dashboard de tráfego do workspace.
 * Lê só o que a sincronização já gravou no Supabase (abre rápido e não depende de API externa).
 */

import Link from "next/link";
import { BotaoSincronizar } from "@/components/trafego/BotaoSincronizar";
import { CartaoKpi } from "@/components/trafego/CartaoKpi";
import { Funil } from "@/components/trafego/Funil";
import { GraficoRoas } from "@/components/trafego/GraficoRoas";
import { TopAnuncios } from "@/components/trafego/TopAnuncios";
import {
  agruparPorAnuncio, brl, derivar, funil, multiplicador, percent, porDia, somar, variacao,
} from "@/lib/trafego/metricas";
import { dia, metricaDoBanco, type LinhaMetrica } from "@/lib/trafego/tipos";
import { carregarWorkspace } from "../carregar";

export const dynamic = "force-dynamic";

const PERIODOS = [7, 14, 30, 60];
const PLATAFORMAS_FILTRO = ["todas", "google_ads", "facebook"];

export default async function PaginaTrafego(props: PageProps<"/painel/[workspaceId]/trafego">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace } = await carregarWorkspace(workspaceId);
  const filtros = await props.searchParams;

  const dias = PERIODOS.includes(Number(filtros.dias)) ? Number(filtros.dias) : 14;
  const plataforma = typeof filtros.plataforma === "string" && PLATAFORMAS_FILTRO.includes(filtros.plataforma)
    ? filtros.plataforma : "todas";

  const de = dia(-dias);
  const ate = dia(-1);
  const deAnterior = dia(-dias * 2);
  const ateAnterior = dia(-dias - 1);

  const [{ data: brutoAtual }, { data: brutoAnterior }, { data: syncs }, { data: cfg }] = await Promise.all([
    supabase.from("trafego_metricas_dia").select("*").eq("workspace_id", workspace.id).gte("data", de).lte("data", ate),
    supabase.from("trafego_metricas_dia").select("*").eq("workspace_id", workspace.id).gte("data", deAnterior).lte("data", ateAnterior),
    supabase.from("trafego_sincronizacoes").select("terminado_em").eq("workspace_id", workspace.id)
      .eq("status", "ok").order("iniciado_em", { ascending: false }).limit(1),
    supabase.from("trafego_config").select("valor").eq("workspace_id", workspace.id).eq("chave", "custos_percent").maybeSingle(),
  ]);

  const custos = Number(cfg?.valor ?? 25);
  const filtrar = (linhas: LinhaMetrica[]) =>
    plataforma === "todas" ? linhas : linhas.filter((l) => l.plataforma === plataforma);

  const atual = filtrar((brutoAtual ?? []).map(metricaDoBanco));
  const anterior = filtrar((brutoAnterior ?? []).map(metricaDoBanco));

  const totais = somar(atual);
  const d = derivar(totais, custos);
  const totaisAnt = somar(anterior);
  const dAnt = derivar(totaisAnt, custos);

  const kpis = [
    { rotulo: "Gasto", valor: brl(totais.gasto), variacao: variacao(totais.gasto, totaisAnt.gasto), neutro: true },
    { rotulo: "Faturamento", valor: brl(totais.receita), variacao: variacao(totais.receita, totaisAnt.receita) },
    { rotulo: "Lucro", valor: brl(d.lucro), variacao: variacao(d.lucro, dAnt.lucro) },
    { rotulo: "Ticket médio", valor: brl(d.ticket), variacao: variacao(d.ticket, dAnt.ticket) },
    { rotulo: "ROAS", valor: multiplicador(d.roas), variacao: variacao(d.roas, dAnt.roas) },
    { rotulo: "CPA", valor: brl(d.cpa), variacao: variacao(d.cpa, dAnt.cpa), inverso: true },
    { rotulo: "Margem", valor: percent(d.margem), variacao: variacao(d.margem, dAnt.margem) },
    { rotulo: "Connect rate", valor: percent(d.connectRate), variacao: variacao(d.connectRate, dAnt.connectRate) },
  ];

  const caminho = `/painel/${workspace.id}/trafego`;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-zinc-100">Visão geral do tráfego</h1>
          <p className="text-xs text-zinc-500">
            {de.split("-").reverse().join("/")} a {ate.split("-").reverse().join("/")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODOS.map((p) => (
            <Link
              key={p}
              href={{ pathname: caminho, query: { plataforma, dias: p } }}
              className={"rounded-lg border px-2.5 py-1 text-xs " + (p === dias ? "border-amber-400 text-amber-400" : "border-zinc-700 text-zinc-400")}
            >
              {p} dias
            </Link>
          ))}
          <BotaoSincronizar workspaceId={workspace.id} ultimaSync={syncs?.[0]?.terminado_em ?? null} />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => <CartaoKpi key={k.rotulo} {...k} />)}
      </section>

      <section className="mt-4 grid gap-3 lg:grid-cols-[2fr_1fr]">
        <GraficoRoas dias={porDia(atual, de, ate, custos)} />
        <Funil etapas={funil(totais)} />
      </section>

      <section className="mt-4">
        <TopAnuncios itens={agruparPorAnuncio(atual, custos)} />
      </section>
    </main>
  );
}
