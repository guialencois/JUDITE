/**
 * Diretor (CMO): relatório do dia escrito pela IA a partir dos dados reais do workspace,
 * com recomendações que o dono ou um admin aprovam ou recusam. Nada é executado sozinho aqui.
 */

import Link from "next/link";
import { BotaoEnviar } from "@/components/BotaoEnviar";
import { iaConfigurada } from "@/lib/diretor/claude";
import { ROTULO_TIPO, type TipoRecomendacao } from "@/lib/diretor/tipos";
import { podeAgir } from "@/lib/trafego/acesso";
import { brl } from "@/lib/trafego/metricas";
import { NOME_PLATAFORMA, type Plataforma } from "@/lib/trafego/tipos";
import { carregarWorkspace } from "../carregar";
import { decidir, gerarAgora } from "./actions";

export const dynamic = "force-dynamic";
// Gerar o relatório chama a IA e pode levar mais de um minuto.
export const maxDuration = 300;

const ERROS: Record<string, string> = {
  papel: "Só o dono ou um admin do workspace pode gerar relatórios e decidir recomendações.",
  recente: "Já existe um relatório gerado há menos de 10 minutos. Aguarde um pouco para gerar outro.",
  geracao: "Não foi possível gerar o relatório. O motivo aparece abaixo, na última tentativa.",
  decisao: "Não foi possível registrar a decisão (talvez ela já tenha sido decidida).",
};
const AVISOS: Record<string, string> = {
  gerado: "Relatório gerado.",
  aprovada: "Recomendação aprovada.",
  recusada: "Recomendação recusada.",
};
const COR_PONTO: Record<string, string> = {
  positivo: "border-emerald-500/40 bg-emerald-500/10",
  atencao: "border-amber-500/40 bg-amber-500/10",
  critico: "border-rose-500/40 bg-rose-500/10",
  informacao: "border-zinc-700 bg-zinc-900/60",
};
const COR_PRIORIDADE: Record<string, string> = { alta: "text-rose-300", media: "text-amber-300", baixa: "text-zinc-400" };
const COR_STATUS: Record<string, string> = {
  proposta: "bg-amber-500/15 text-amber-300",
  aprovada: "bg-emerald-500/15 text-emerald-300",
  executada: "bg-emerald-500/15 text-emerald-300",
  recusada: "bg-zinc-800 text-zinc-400",
};
const ROTULO_STATUS: Record<string, string> = {
  proposta: "aguardando decisão", aprovada: "aprovada", recusada: "recusada", executada: "executada",
};

const codigo = "rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-amber-300";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

type Ponto = { tipo: string; titulo: string; detalhe: string };
type Descartada = { titulo: string; motivo: string };

export default async function DiretorPage(props: PageProps<"/painel/[workspaceId]/diretor">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const gestor = podeAgir(papel);
  const params = await props.searchParams;
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;
  const aviso = typeof params.aviso === "string" ? AVISOS[params.aviso] : undefined;
  const temChave = iaConfigurada();

  const { data: relatorios, error: erroTabela } = await supabase
    .from("diretor_relatorios")
    .select("id, dia, criado_em, origem, status, erro, diagnostico, pontos, descartadas, modelo")
    .eq("workspace_id", workspace.id).order("criado_em", { ascending: false }).limit(15);

  const ultimaTentativa = relatorios?.[0];
  const relatorio = relatorios?.find((r) => r.status === "ok");
  const { data: recomendacoes } = relatorio
    ? await supabase.from("diretor_recomendacoes").select("*").eq("relatorio_id", relatorio.id).order("ordem")
    : { data: [] };
  const { data: campanhas } = await supabase.from("trafego_campanhas").select("plataforma, campanha_id, nome").eq("workspace_id", workspace.id);
  const nomeCampanha = (p: string | null, id: string | null) =>
    campanhas?.find((c) => c.campanha_id === id && (!p || c.plataforma === p))?.nome || id || "";

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Diretor</h1>
          <p className="text-sm text-zinc-500">
            Análise diária do marketing feita pela JUDITE, com recomendações para você aprovar ou recusar.
          </p>
        </div>
        {gestor && temChave && !erroTabela && (
          <form action={gerarAgora}>
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <BotaoEnviar className={botao} aguarde="Analisando... (pode levar 1 minuto)">Gerar relatório agora</BotaoEnviar>
          </form>
        )}
      </header>

      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</p>}

      {!temChave && (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-medium">Falta a chave da IA para o Diretor funcionar.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Abra <code className={codigo}>console.anthropic.com</code> → <strong>API Keys</strong> → <strong>Create Key</strong> e copie a chave.</li>
            <li>No site da Vercel: projeto JUDITE → <strong>Settings → Environment Variables</strong> → crie <code className={codigo}>ANTHROPIC_API_KEY</code> com a chave e marque Production e Preview.</li>
            <li>Para testar no seu computador, coloque a mesma linha no arquivo <code className={codigo}>.env.local</code>.</li>
            <li>Na Vercel, faça um novo deploy (Deployments → Redeploy) para a chave valer.</li>
          </ol>
          <p className="text-xs text-amber-200/80">A chave fica só no servidor; nunca aparece no navegador. O uso da IA é cobrado pela Anthropic conforme o consumo.</p>
        </div>
      )}

      {erroTabela && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          As tabelas do Diretor ainda não existem no banco. Aplique a migração da Etapa 6 no Supabase
          (o passo a passo está em <code className={codigo}>docs/PENDENTE.md</code>) e recarregue esta página.
        </p>
      )}

      {ultimaTentativa?.status === "erro" && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          A última tentativa ({quando(ultimaTentativa.criado_em as string)}) falhou: {ultimaTentativa.erro as string}
        </p>
      )}

      {!erroTabela && !relatorio && (
        <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-400">
          Ainda não há relatório. {temChave
            ? (gestor ? "Clique em \"Gerar relatório agora\" ou aguarde a análise automática de amanhã cedo." : "A análise automática roda uma vez por dia.")
            : "Depois de cadastrar a chave, o primeiro relatório pode ser gerado aqui."}
        </p>
      )}

      {relatorio && (
        <>
          <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-xl">Relatório de {(relatorio.dia as string).split("-").reverse().join("/")}</h2>
              <p className="text-xs text-zinc-500">
                gerado em {quando(relatorio.criado_em as string)} · {relatorio.origem === "cron" ? "análise automática" : "pedido manual"}
              </p>
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-zinc-200">
              {String(relatorio.diagnostico ?? "").split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </section>

          {((relatorio.pontos ?? []) as Ponto[]).length > 0 && (
            <section className="grid gap-3 sm:grid-cols-2">
              {((relatorio.pontos ?? []) as Ponto[]).map((p, i) => (
                <div key={i} className={"rounded-xl border p-4 text-sm " + (COR_PONTO[p.tipo] ?? COR_PONTO.informacao)}>
                  <p className="font-medium text-zinc-100">{p.titulo}</p>
                  <p className="mt-1 text-zinc-300">{p.detalhe}</p>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-3">
            <h2 className="font-serif text-xl">Recomendações</h2>
            <p className="text-xs text-zinc-500">
              Aprovar registra a sua decisão. Nesta versão o Diretor não muda nada sozinho: para aplicar uma mudança de verba,
              use o <Link href={`/painel/${workspace.id}/trafego/gerenciador`} className="underline">Gerenciador</Link>.
            </p>
            {(recomendacoes ?? []).map((r) => (
              <article key={r.id} className="space-y-2 rounded-xl border border-zinc-800 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">{ROTULO_TIPO[r.tipo as TipoRecomendacao] ?? r.tipo}</span>
                    <span className={COR_PRIORIDADE[r.prioridade as string] ?? "text-zinc-400"}>prioridade {r.prioridade === "media" ? "média" : r.prioridade}</span>
                  </div>
                  <span className={"rounded-full px-2 py-0.5 text-xs " + (COR_STATUS[r.status as string] ?? "")}>{ROTULO_STATUS[r.status as string] ?? r.status}</span>
                </div>
                <h3 className="text-base font-medium text-zinc-100">{r.titulo}</h3>
                {r.campanha_id && (
                  <p className="text-xs text-zinc-400">
                    Campanha: {nomeCampanha(r.plataforma as string | null, r.campanha_id as string)}
                    {r.plataforma ? ` · ${NOME_PLATAFORMA[r.plataforma as Plataforma] ?? r.plataforma}` : ""}
                    {r.valor_sugerido !== null && r.valor_sugerido !== undefined ? ` · novo orçamento sugerido: ${brl(Number(r.valor_sugerido))}/dia` : ""}
                  </p>
                )}
                <p className="text-zinc-300">{r.justificativa}</p>
                {r.impacto_esperado && <p className="text-zinc-400"><span className="text-zinc-500">Efeito esperado: </span>{r.impacto_esperado}</p>}
                {r.resultado && <p className="text-xs text-zinc-500">Resultado: {r.resultado}</p>}
                {gestor && r.status === "proposta" && (
                  <div className="flex gap-2 pt-1">
                    <form action={decidir}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="recomendacaoId" value={r.id} />
                      <input type="hidden" name="decisao" value="aprovar" />
                      <BotaoEnviar className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-zinc-950" aguarde="Salvando...">Aprovar</BotaoEnviar>
                    </form>
                    <form action={decidir}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="recomendacaoId" value={r.id} />
                      <input type="hidden" name="decisao" value="recusar" />
                      <BotaoEnviar className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300" aguarde="Salvando...">Recusar</BotaoEnviar>
                    </form>
                  </div>
                )}
              </article>
            ))}
            {!(recomendacoes ?? []).length && (
              <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">Nenhuma recomendação neste relatório.</p>
            )}
          </section>

          {((relatorio.descartadas ?? []) as Descartada[]).length > 0 && (
            <details className="rounded-xl border border-zinc-800 p-4 text-sm">
              <summary className="cursor-pointer text-zinc-400">
                {((relatorio.descartadas ?? []) as Descartada[]).length} sugestão(ões) da IA barrada(s) pelas regras de prudência
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-400">
                {((relatorio.descartadas ?? []) as Descartada[]).map((d, i) => <li key={i}><span className="text-zinc-300">{d.titulo}</span>: {d.motivo}.</li>)}
              </ul>
            </details>
          )}
        </>
      )}

      {(relatorios ?? []).filter((r) => r.status === "ok").length > 1 && (
        <section className="text-xs text-zinc-500">
          Relatórios anteriores: {(relatorios ?? []).filter((r) => r.status === "ok").slice(1).map((r) => quando(r.criado_em as string)).join(" · ")}
        </section>
      )}
    </main>
  );
}
