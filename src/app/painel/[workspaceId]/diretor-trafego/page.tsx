/**
 * Diretor de Tráfego: o lugar único onde a JUDITE mostra o que quer fazer e o que já fez sozinha,
 * e onde o humano avalia. Reúne numa fila só:
 *   - campanhas novas que ela propôs (aprovar cria PAUSADA; ligar é outra aprovação);
 *   - mudanças de verba que a autonomia quis fazer mas passaram de algum limite;
 *   - recomendações de verba do relatório diário.
 * Nada aqui é aplicado sem o clique de uma pessoa com permissão.
 */

import Link from "next/link";
import { BotaoEnviar } from "@/components/BotaoEnviar";
import { MAX_PROPOSTAS_PENDENTES } from "@/lib/campanhas/propor";
import { publicacaoReal, ROTULO_OBJETIVO, type Objetivo, type Publico } from "@/lib/campanhas/rascunho";
import { ROTULO_TIPO, TIPOS_DE_VERBA, type TipoRecomendacao } from "@/lib/diretor/tipos";
import { iaConfigurada, PROVEDORES_IA, provedorParaConfigurar } from "@/lib/ia";
import { podeAgir } from "@/lib/trafego/acesso";
import { brl } from "@/lib/trafego/metricas";
import { dia, NOME_PLATAFORMA, type Plataforma } from "@/lib/trafego/tipos";
import { decidirRascunho } from "../campanhas/actions";
import { carregarWorkspace } from "../carregar";
import { decidir, pararTudo } from "../diretor/actions";
import { decidirAcaoPendente, proporAgora } from "./actions";

export const dynamic = "force-dynamic";
// Pedir uma proposta chama a IA e pode levar mais de um minuto.
export const maxDuration = 300;

const ERROS: Record<string, string> = {
  papel: "Só o dono ou um admin do workspace pode usar o Diretor de Tráfego.",
  "so-dono": "Só o dono do workspace pode aprovar, recusar ou ativar campanhas.",
  recente: "A JUDITE acabou de montar uma proposta. Aguarde um minuto para pedir outra.",
  proposta: "A JUDITE não montou uma proposta agora:",
  plataforma: "A ação não foi aplicada:",
  decisao: "Não foi possível registrar a decisão (talvez ela já tenha sido decidida).",
  execucao: "A decisão foi registrada, mas a mudança não pôde ser aplicada:",
  migracao: "Para aprovar ou dispensar ações da autonomia por aqui, aplique antes a migração do Diretor de Tráfego no Supabase (veja docs/PENDENTE.md).",
  autonomia: "Não foi possível mudar a autonomia.",
};
const AVISOS: Record<string, string> = {
  proposta: "A JUDITE montou uma proposta de campanha. Ela está abaixo, aguardando a sua avaliação.",
  recusada: "Recusado. Nada foi criado nem mudado.",
  publicada: "Campanha criada PAUSADA na plataforma. Para ligar, é preciso aprovar a ativação.",
  "publicada-simulada": "Aprovado em MODO SIMULADO: nada foi criado na plataforma. Agora você pode testar a ativação.",
  ativada: "Campanha ativada na plataforma.",
  "ativada-simulada": "Ativação simulada: nada mudou na plataforma.",
  aplicada: "Aprovado e aplicado na conta de anúncios.",
  dispensada: "Ação dispensada. Nada foi mudado.",
  aprovada: "Recomendação aprovada.",
  executada: "Recomendação aprovada e aplicada na plataforma.",
  "autonomia-desligada": "Autonomia desligada. A JUDITE não faz mais nada sozinha.",
};
const ROTULO_ACAO: Record<string, string> = {
  pausar: "Pausar campanha", ativar: "Ativar campanha", definir_orcamento: "Mudar orçamento diário", criar_campanha_pausada: "Propor campanha nova",
};
const ROTULO_STATUS_ACAO: Record<string, string> = {
  aplicada: "aplicada", erro: "erro", aguardando_aprovacao: "aguardando você", aprovada: "aprovada por você", dispensada: "dispensada",
};

const cartao = "rounded-xl border border-zinc-800 bg-zinc-900/60 p-4";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";
const aprovar = "rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-zinc-950";
const recusar = "rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300";
const etiqueta = "rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300";
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const DIAS_DA_FILA = 14;

/** Campos escondidos comuns a todos os formulários de decisão (voltam para esta página). */
function Ocultos({ ws, campos }: { ws: string; campos: Record<string, string> }) {
  return (
    <>
      <input type="hidden" name="workspaceId" value={ws} />
      <input type="hidden" name="voltar" value="diretor-trafego" />
      {Object.entries(campos).map(([nome, valor]) => <input key={nome} type="hidden" name={nome} value={valor} />)}
    </>
  );
}

export default async function DiretorTrafegoPage(props: PageProps<"/painel/[workspaceId]/diretor-trafego">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const gestor = podeAgir(papel);
  const dono = papel === "owner";
  const params = await props.searchParams;
  const motivo = typeof params.motivo === "string" ? params.motivo.slice(0, 200) : "";
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;
  const aviso = typeof params.aviso === "string" ? AVISOS[params.aviso] : undefined;
  const real = publicacaoReal();
  const temChave = iaConfigurada();
  const base = `/painel/${workspace.id}`;
  const desde = dia(-DIAS_DA_FILA);

  const [rascunhosR, produtosR, criativosR, pendentesR, recomendacoesR, feitasR, autonomiaR, campanhasR] = await Promise.all([
    supabase.from("campanha_rascunhos").select("*").eq("workspace_id", workspace.id)
      .in("status", ["aguardando_aprovacao", "publicada_pausada"]).order("criado_em", { ascending: false }).limit(20),
    supabase.from("produtos").select("id, nome").eq("workspace_id", workspace.id).eq("ativo", true),
    supabase.from("criativos").select("id, titulo").eq("workspace_id", workspace.id).limit(200),
    supabase.from("trafego_acoes").select("id, criado_em, plataforma, entidade_nome, acao, valor_antes, valor_depois, resultado")
      .eq("workspace_id", workspace.id).eq("origem", "automacao").eq("status", "aguardando_aprovacao")
      .in("acao", ["pausar", "ativar", "definir_orcamento"]).gte("criado_em", desde).order("criado_em", { ascending: false }).limit(20),
    supabase.from("diretor_recomendacoes").select("*").eq("workspace_id", workspace.id).eq("status", "proposta")
      .in("tipo", TIPOS_DE_VERBA).gte("criado_em", desde).order("criado_em", { ascending: false }).limit(10),
    supabase.from("trafego_acoes").select("id, criado_em, plataforma, entidade_nome, acao, valor_antes, valor_depois, status, resultado")
      .eq("workspace_id", workspace.id).eq("origem", "automacao").order("criado_em", { ascending: false }).limit(15),
    supabase.from("autonomia").select("ligada, ligada_em").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("trafego_campanhas").select("plataforma, campanha_id, nome").eq("workspace_id", workspace.id),
  ]);
  const semTabela = Boolean(rascunhosR.error);
  const rascunhos = rascunhosR.data ?? [];
  const propostas = rascunhos.filter((r) => r.status === "aguardando_aprovacao");
  const paraAtivar = rascunhos.filter((r) => r.status === "publicada_pausada");
  const pendentes = pendentesR.data ?? [];
  const recomendacoes = recomendacoesR.data ?? [];
  const feitas = feitasR.data ?? [];
  const ligada = autonomiaR.data?.ligada === true;
  const totalFila = propostas.length + paraAtivar.length + pendentes.length + recomendacoes.length;
  const tituloCriativo = (id: string) => criativosR.data?.find((c) => c.id === id)?.titulo ?? "criativo";
  const nomeCampanha = (p: string | null, id: string | null) =>
    campanhasR.data?.find((c) => c.campanha_id === id && (!p || c.plataforma === p))?.nome || id || "";
  const plataforma = (p: unknown) => NOME_PLATAFORMA[p as Plataforma] ?? String(p ?? "");
  const mudanca = (a: { acao: unknown; valor_antes: unknown; valor_depois: unknown }) =>
    a.acao === "definir_orcamento"
      ? ` de ${brl(a.valor_antes === null ? null : Number(a.valor_antes))} para ${brl(Number(a.valor_depois ?? 0))} por dia`
      : a.acao === "criar_campanha_pausada" ? ` com ${brl(Number(a.valor_depois ?? 0))} por dia` : "";

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Diretor de Tráfego</h1>
          <p className="max-w-2xl text-sm text-zinc-500">
            A JUDITE analisa os dados todo dia, propõe campanhas novas e cuida da verba. Aqui você vê tudo o que ela quer fazer
            e o que já fez, e decide. Nenhuma campanha é criada e nenhum real a mais é gasto sem a sua aprovação.
          </p>
        </div>
        {gestor && temChave && !semTabela && (
          <form action={proporAgora}>
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <BotaoEnviar className={botao} aguarde="Montando... (pode levar 1 minuto)">Pedir uma campanha nova agora</BotaoEnviar>
          </form>
        )}
      </header>

      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}{motivo ? ` ${motivo}` : ""}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</p>}

      {/* ---------------------------------------------------------------- Situação */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className={cartao + " space-y-1 text-sm"}>
          <p className="text-xs text-zinc-500">Propostas de campanha</p>
          <p className={temChave ? "text-emerald-300" : "text-amber-300"}>{temChave ? "Ligadas: 1 por dia, de manhã" : "Paradas: falta a chave da IA"}</p>
          <p className="text-xs text-zinc-500">
            {temChave
              ? `Ela escolhe um produto do Creative Studio e monta a campanha. Para de propor quando há ${MAX_PROPOSTAS_PENDENTES} esperando você.`
              : <>Cadastre <code className="font-mono">{PROVEDORES_IA[provedorParaConfigurar()].variavel}</code>. O passo a passo está na página <Link href={`${base}/diretor`} className="underline">Diretor</Link>.</>}
          </p>
        </div>
        <div className={cartao + " space-y-1 text-sm"}>
          <p className="text-xs text-zinc-500">Autonomia sobre a verba</p>
          <p className={ligada ? "text-emerald-300" : "text-zinc-300"}>
            {ligada ? `Ligada${autonomiaR.data?.ligada_em ? " desde " + quando(autonomiaR.data.ligada_em as string) : ""}` : "Desligada"}
          </p>
          {ligada && gestor ? (
            <form action={pararTudo}>
              <Ocultos ws={workspace.id} campos={{}} />
              <BotaoEnviar className="mt-1 rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white" aguarde="Parando...">Parar tudo</BotaoEnviar>
            </form>
          ) : (
            <p className="text-xs text-zinc-500">
              {ligada ? "Ela pausa campanha ruim e ajusta verba até 10%, dentro dos limites." : "Ela só propõe; não pausa nem muda verba sozinha."}{" "}
              <Link href={`${base}/diretor`} className="underline">Regras e chave de ligar</Link>
            </p>
          )}
        </div>
        <div className={cartao + " space-y-1 text-sm"}>
          <p className="text-xs text-zinc-500">Criação de campanhas</p>
          <p className={real ? "text-rose-300" : "text-sky-300"}>{real ? "Modo real" : "Modo simulado"}</p>
          <p className="text-xs text-zinc-500">
            {real
              ? "Aprovar cria a campanha de verdade na plataforma, sempre pausada. Ativar faz gastar."
              : "Aprovar e ativar acontecem só dentro da JUDITE. Nada é criado nas plataformas."}
          </p>
        </div>
      </section>

      {semTabela && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          As tabelas de campanhas ainda não existem no banco. Aplique as migrações no Supabase (a lista está em docs/PENDENTE.md) e recarregue.
        </p>
      )}
      {!semTabela && temChave && !(produtosR.data ?? []).length && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          Para a JUDITE propor campanhas, cadastre pelo menos um produto no{" "}
          <Link href={`${base}/criativos`} className="underline">Creative Studio</Link> (nome, preço e os fatos do passeio). Ela só usa o que estiver cadastrado.
        </p>
      )}

      {/* ---------------------------------------------------------------- Fila */}
      <section className="space-y-3">
        <h2 className="font-serif text-xl">Para você avaliar {totalFila > 0 && <span className="text-amber-300">({totalFila})</span>}</h2>

        {propostas.map((r) => {
          const publico = (r.publico ?? {}) as Partial<Publico>;
          const avisos = (r.avisos ?? []) as string[];
          const ids = (r.criativo_ids ?? []) as string[];
          return (
            <article key={r.id} className={cartao + " space-y-2 text-sm"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={etiqueta}>Campanha nova</span>
                <span className="text-xs text-zinc-500">
                  {r.origem === "diretor" ? "proposta pela JUDITE" : "montada à mão"} em {quando(r.criado_em as string)}
                </span>
              </div>
              <h3 className="text-base font-medium text-zinc-100">{r.nome}</h3>
              <p className="text-zinc-400">
                {plataforma(r.plataforma)} · {ROTULO_OBJETIVO[r.objetivo as Objetivo] ?? r.objetivo} · <strong className="text-zinc-200">{brl(Number(r.orcamento_diario))} por dia</strong>
              </p>
              <p className="text-xs text-zinc-500">
                Público: {[publico.regiao, publico.idade_min || publico.idade_max ? `${publico.idade_min ?? 18} a ${publico.idade_max ?? 65} anos` : "", publico.interesses]
                  .filter(Boolean).join(" · ") || "não informado"}
                {ids.length > 0 && <> · Criativos: {ids.map(tituloCriativo).join("; ")}</>}
              </p>
              {r.justificativa && <p className="text-zinc-300">{r.justificativa}</p>}
              {avisos.length > 0 && (
                <ul className="list-disc space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 py-2 pl-7 pr-3 text-xs text-amber-100">
                  {avisos.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              )}
              {dono ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <form action={decidirRascunho}>
                    <Ocultos ws={workspace.id} campos={{ rascunhoId: r.id as string, decisao: "aprovar" }} />
                    <BotaoEnviar className={aprovar} aguarde="Criando...">{real ? "Aprovar e criar pausada" : "Aprovar (simulado)"}</BotaoEnviar>
                  </form>
                  <form action={decidirRascunho}>
                    <Ocultos ws={workspace.id} campos={{ rascunhoId: r.id as string, decisao: "recusar" }} />
                    <BotaoEnviar className={recusar} aguarde="Salvando...">Recusar</BotaoEnviar>
                  </form>
                </div>
              ) : <p className="text-xs text-zinc-500">Só o dono do workspace aprova campanhas novas.</p>}
            </article>
          );
        })}

        {paraAtivar.map((r) => (
          <article key={r.id} className={cartao + " space-y-2 text-sm"}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={etiqueta}>Ligar campanha</span>
              <span className="text-xs text-sky-300">criada e pausada{r.simulada ? " · SIMULADA" : ""}</span>
            </div>
            <h3 className="text-base font-medium text-zinc-100">{r.nome}</h3>
            <p className="text-zinc-400">{plataforma(r.plataforma)} · {brl(Number(r.orcamento_diario))} por dia</p>
            {!r.simulada && (
              <p className="text-xs text-zinc-500">Antes de ligar, finalize o público e os anúncios na plataforma, seguindo a proposta. Ligar faz a campanha começar a gastar.</p>
            )}
            {dono ? (
              <form action={decidirRascunho}>
                <Ocultos ws={workspace.id} campos={{ rascunhoId: r.id as string, decisao: "ativar" }} />
                <BotaoEnviar className="rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-medium text-zinc-950" aguarde="Ativando...">
                  {r.simulada ? "Aprovar ativação (simulado)" : "Aprovar ativação (começa a gastar)"}
                </BotaoEnviar>
              </form>
            ) : <p className="text-xs text-zinc-500">Só o dono do workspace ativa campanhas.</p>}
          </article>
        ))}

        {pendentes.map((a) => (
          <article key={a.id} className={cartao + " space-y-2 text-sm"}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={etiqueta}>{ROTULO_ACAO[a.acao as string] ?? a.acao}</span>
              <span className="text-xs text-zinc-500">a autonomia quis fazer em {quando(a.criado_em as string)}, mas passou de um limite</span>
            </div>
            <h3 className="text-base font-medium text-zinc-100">{a.entidade_nome}</h3>
            <p className="text-zinc-400">{plataforma(a.plataforma)}{mudanca(a)}</p>
            {a.resultado && <p className="text-zinc-300">{String(a.resultado).slice(0, 400)}</p>}
            {gestor && (
              <div className="flex flex-wrap gap-2 pt-1">
                <form action={decidirAcaoPendente}>
                  <Ocultos ws={workspace.id} campos={{ acaoId: a.id as string, decisao: "aprovar" }} />
                  <BotaoEnviar className={aprovar} aguarde="Aplicando...">Aprovar e aplicar na conta</BotaoEnviar>
                </form>
                <form action={decidirAcaoPendente}>
                  <Ocultos ws={workspace.id} campos={{ acaoId: a.id as string, decisao: "dispensar" }} />
                  <BotaoEnviar className={recusar} aguarde="Salvando...">Dispensar</BotaoEnviar>
                </form>
              </div>
            )}
          </article>
        ))}

        {recomendacoes.map((r) => (
          <article key={r.id} className={cartao + " space-y-2 text-sm"}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={etiqueta}>{ROTULO_TIPO[r.tipo as TipoRecomendacao] ?? r.tipo}</span>
              <span className="text-xs text-zinc-500">recomendação do relatório de {quando(r.criado_em as string)}</span>
            </div>
            <h3 className="text-base font-medium text-zinc-100">{r.titulo}</h3>
            {r.campanha_id && (
              <p className="text-zinc-400">
                {nomeCampanha(r.plataforma as string | null, r.campanha_id as string)}{r.plataforma ? ` · ${plataforma(r.plataforma)}` : ""}
                {r.valor_sugerido !== null && r.valor_sugerido !== undefined ? ` · novo orçamento sugerido: ${brl(Number(r.valor_sugerido))} por dia` : ""}
              </p>
            )}
            <p className="text-zinc-300">{r.justificativa}</p>
            {gestor && (
              <div className="flex flex-wrap gap-2 pt-1">
                <form action={decidir}>
                  <Ocultos ws={workspace.id} campos={{ recomendacaoId: r.id as string, decisao: "aprovar" }} />
                  <BotaoEnviar className={aprovar} aguarde="Aplicando...">Aprovar e aplicar na conta</BotaoEnviar>
                </form>
                <form action={decidir}>
                  <Ocultos ws={workspace.id} campos={{ recomendacaoId: r.id as string, decisao: "recusar" }} />
                  <BotaoEnviar className={recusar} aguarde="Salvando...">Recusar</BotaoEnviar>
                </form>
              </div>
            )}
          </article>
        ))}

        {totalFila === 0 && (
          <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">
            Nada esperando por você agora. {temChave ? "A próxima análise automática roda amanhã cedo." : ""}
          </p>
        )}
        <p className="text-xs text-zinc-500">
          Recomendações que não mexem em verba (site, criativos, perfil no Google) ficam no relatório da página{" "}
          <Link href={`${base}/diretor`} className="underline">Diretor</Link>. Todas as campanhas, inclusive as recusadas, estão em{" "}
          <Link href={`${base}/campanhas`} className="underline">Campanhas</Link>.
        </p>
      </section>

      {/* ---------------------------------------------------------------- Histórico */}
      <section className="space-y-2">
        <h2 className="font-serif text-xl">O que a JUDITE fez sozinha</h2>
        <ul className="space-y-1 text-xs">
          {feitas.map((a) => (
            <li key={a.id} className="rounded-lg bg-zinc-900/60 px-3 py-2 text-zinc-400">
              <span className="text-zinc-500">{quando(a.criado_em as string)}</span> · <span className="text-zinc-200">{a.entidade_nome}</span>
              {" · "}{ROTULO_ACAO[a.acao as string] ?? a.acao}{mudanca(a)}{" · "}
              <span className={a.status === "aplicada" ? "text-emerald-300" : a.status === "erro" ? "text-rose-300" : a.status === "aguardando_aprovacao" ? "text-amber-300" : "text-zinc-300"}>
                {ROTULO_STATUS_ACAO[a.status as string] ?? a.status}
              </span>
              {a.resultado ? <span className="block text-zinc-500">{String(a.resultado).slice(0, 220)}</span> : null}
            </li>
          ))}
          {!feitas.length && <li className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">Nenhuma ação automática até agora.</li>}
        </ul>
        <p className="text-xs text-zinc-500">
          O histórico completo, com as mudanças feitas por pessoas, está no <Link href={`${base}/trafego/gerenciador`} className="underline">Gerenciador</Link>.
        </p>
      </section>
    </main>
  );
}
