/**
 * Aba Site: o que acontece no site do cliente, medido pelo rastreador próprio da JUDITE.
 * Mostra visitas, origem (anúncio, Instagram, Google...), páginas e o que mais importa:
 * quantas pessoas clicaram no WhatsApp e no carrinho, e vindas de onde.
 */

import Link from "next/link";
import { podeAgir } from "@/lib/trafego/acesso";
import { urlDoSite } from "@/lib/conexoes/config";
import { agrupar, canal, inicioDoPeriodo, porDia, totais, type EventoSite, type Linha } from "@/lib/site/resumo";
import { carregarWorkspace } from "../carregar";
import { cadastrarSite, removerSite } from "./actions";

export const dynamic = "force-dynamic";

const PERIODOS = [1, 7, 30, 90];
const ERROS: Record<string, string> = {
  dominio: "Digite só o domínio, por exemplo: guialencois.org",
  salvar: "Não foi possível cadastrar. Talvez esse domínio já esteja cadastrado.",
};

const inteiro = (n: number) => n.toLocaleString("pt-BR");
const pct = (n: number | null) => (n === null ? "-" : (n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%");
const codigo = "rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-amber-300 break-all";

function Tabela({ titulo, linhas, coluna }: { titulo: string; linhas: Linha[]; coluna: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-3 font-serif text-lg">{titulo}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500">
            <th className="py-1 pr-2 font-medium">{coluna}</th>
            <th className="py-1 pr-2 text-right font-medium">Visitantes</th>
            <th className="py-1 pr-2 text-right font-medium">WhatsApp</th>
            <th className="py-1 text-right font-medium">Carrinho</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-t border-zinc-800">
              <td className="max-w-[220px] truncate py-1.5 pr-2 text-zinc-300">{l.rotulo}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{inteiro(l.visitantes)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-400">{inteiro(l.whatsapp)}</td>
              <td className="py-1.5 text-right tabular-nums text-amber-400">{inteiro(l.carrinho)}</td>
            </tr>
          ))}
          {!linhas.length && (
            <tr><td colSpan={4} className="py-4 text-center text-zinc-500">Sem dados no período.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function SitePage(props: PageProps<"/painel/[workspaceId]/site">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const params = await props.searchParams;
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;
  const dias = PERIODOS.includes(Number(params.dias)) ? Number(params.dias) : 7;

  const { data: sites } = await supabase.from("sites").select("id, dominio, chave").eq("workspace_id", workspace.id).order("criado_em");
  const judite = await urlDoSite();
  const gestor = podeAgir(papel);

  if (!sites?.length) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        <h1 className="font-serif text-3xl">Site</h1>
        <p className="text-sm text-zinc-400">
          Cadastre o domínio do site para a JUDITE começar a medir visitas, origem e cliques no WhatsApp e no carrinho.
          Sem cookies e sem guardar dados pessoais dos visitantes.
        </p>
        {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}</p>}
        {gestor ? (
          <form action={cadastrarSite} className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 p-4">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <label className="min-w-[240px] flex-1 space-y-1 text-sm">
              <span className="block">Domínio do site</span>
              <input name="dominio" required placeholder="guialencois.org" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2" />
            </label>
            <button className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950">Cadastrar site</button>
          </form>
        ) : (
          <p className="text-sm text-zinc-500">Peça ao dono ou a um admin do workspace para cadastrar o site.</p>
        )}
      </main>
    );
  }

  const site = sites[0];
  const desde = inicioDoPeriodo(dias);
  const { data } = await supabase
    .from("site_eventos")
    .select("ocorrido_em, tipo, nome, caminho, origem, utm_source, utm_campaign, anuncio, dispositivo, cidade, regiao, visitante")
    .eq("site_id", site.id)
    .gte("ocorrido_em", desde)
    .order("ocorrido_em", { ascending: true })
    .limit(50000);
  const eventos = (data ?? []) as EventoSite[];

  const t = totais(eventos);
  const serie = porDia(eventos, Math.max(dias, 7));
  const maior = Math.max(1, ...serie.map((d) => d.visitantes));
  const snippet = `<script defer src="${judite}/j.js" data-chave="${site.chave}"></script>`;
  const cartoes = [
    { rotulo: "Visitantes", valor: inteiro(t.visitantes) },
    { rotulo: "Visualizações", valor: inteiro(t.visualizacoes) },
    { rotulo: "Cliques no WhatsApp", valor: inteiro(t.whatsapp) },
    { rotulo: "Cliques no carrinho", valor: inteiro(t.carrinho) },
    { rotulo: "Conversão (WhatsApp ÷ visitantes)", valor: pct(t.conversao) },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Site</h1>
          <p className="text-xs text-zinc-500">{site.dominio}</p>
        </div>
        <div className="flex gap-2">
          {PERIODOS.map((p) => (
            <Link
              key={p}
              href={{ pathname: `/painel/${workspace.id}/site`, query: { dias: p } }}
              className={"rounded-lg border px-2.5 py-1 text-xs " + (p === dias ? "border-amber-400 text-amber-400" : "border-zinc-700 text-zinc-400")}
            >
              {p === 1 ? "Hoje" : `${p} dias`}
            </Link>
          ))}
        </div>
      </header>

      {!eventos.length && (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-medium">Ainda não chegou nenhuma visita. Instale o rastreador no site:</p>
          <p>Cole esta linha dentro do <code className={codigo}>&lt;head&gt;</code> de todas as páginas do {site.dominio}:</p>
          <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs text-amber-300">{snippet}</pre>
          <p className="text-xs text-amber-200/80">
            Os cliques em links do WhatsApp são contados sozinhos. Para contar o carrinho, adicione
            {" "}<code className={codigo}>data-judite=&quot;carrinho&quot;</code> no botão do carrinho.
          </p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cartoes.map((c) => (
          <div key={c.rotulo} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs text-zinc-500">{c.rotulo}</p>
            <p className="mt-1 text-2xl tabular-nums text-zinc-100">{c.valor}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-3 font-serif text-lg">Visitantes por dia</h2>
        <div className="flex h-40 items-end gap-1" role="img" aria-label="Visitantes por dia">
          {serie.map((d) => (
            <div key={d.data} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.data.split("-").reverse().join("/")}: ${d.visitantes} visitantes, ${d.whatsapp} WhatsApp`}>
              <div className="w-full rounded-t bg-amber-400/70" style={{ height: `${(d.visitantes / maior) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-zinc-500">
          <span>{serie[0]?.data.split("-").reverse().join("/")}</span>
          <span>{serie.at(-1)?.data.split("-").reverse().join("/")}</span>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Tabela titulo="De onde vieram" coluna="Origem" linhas={agrupar(eventos, canal)} />
        <Tabela titulo="Campanhas (utm_campaign)" coluna="Campanha" linhas={agrupar(eventos, (e) => e.utm_campaign)} />
        <Tabela titulo="Páginas mais vistas" coluna="Página" linhas={agrupar(eventos, (e) => e.caminho)} />
        <Tabela titulo="Cidades" coluna="Cidade" linhas={agrupar(eventos, (e) => (e.cidade ? `${e.cidade}${e.regiao ? " - " + e.regiao : ""}` : null))} />
        <Tabela titulo="Aparelhos" coluna="Aparelho" linhas={agrupar(eventos, (e) => e.dispositivo)} />
      </section>

      <details className="rounded-xl border border-zinc-800 p-4 text-sm">
        <summary className="cursor-pointer text-zinc-300">Código do rastreador e configurações</summary>
        <div className="mt-3 space-y-2 text-zinc-400">
          <p>Linha para colar no <code className={codigo}>&lt;head&gt;</code> do site:</p>
          <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs text-amber-300">{snippet}</pre>
          <p>
            Para saber qual anúncio trouxe cada visita, use links com <code className={codigo}>utm_source</code> e
            {" "}<code className={codigo}>utm_campaign</code>. Cliques vindos de anúncios do Google, Meta e TikTok são reconhecidos sozinhos.
          </p>
          {gestor && (
            <form action={removerSite}>
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="siteId" value={site.id} />
              <button className="text-zinc-500 hover:text-rose-400">Remover este site (apaga todo o histórico)</button>
            </form>
          )}
        </div>
      </details>
    </main>
  );
}
