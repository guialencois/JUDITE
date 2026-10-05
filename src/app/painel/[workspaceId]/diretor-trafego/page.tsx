/**
 * Diretor de Tráfego: a central de campanhas da CMO.
 *   - Criar: "Criar automaticamente", "Quero ideias" e "Criar campanha" (perguntas mínimas);
 *   - Para você avaliar: a fila única de decisões (campanhas novas, ativações, ações da autonomia, recomendações);
 *   - Campanhas da JUDITE: situação de cada uma (máquina de estados) e o histórico;
 *   - Autonomia em níveis, o último ciclo diário e o que ela fez sozinha.
 * Nada aqui é aplicado sem o clique de uma pessoa com permissão.
 */

import Link from "next/link";
import { BotaoEnviar } from "@/components/BotaoEnviar";
import { COR_NIVEL, DetalhesDoPlano, lerPlano, ROTULO_NIVEL } from "@/components/cmo/DetalhesDoPlano";
import { OBJETIVOS, publicacaoReal, ROTULO_OBJETIVO, type Objetivo, type Publico } from "@/lib/campanhas/rascunho";
import { AGENTES } from "@/lib/cmo/agentes";
import { ehEstado, proximosEstados, RODANDO, ROTULO_ESTADO, type Estado } from "@/lib/cmo/estados";
import { NIVEIS, nivelEfetivo, type Nivel } from "@/lib/cmo/niveis";
import { MAX_PROPOSTAS_PENDENTES } from "@/lib/cmo/oportunidades";
import { ROTULO_TIPO, TIPOS_DE_VERBA, type TipoRecomendacao } from "@/lib/diretor/tipos";
import { iaConfigurada, PROVEDORES_IA, provedorEscolhido, provedorParaConfigurar } from "@/lib/ia";
import { podeAgir } from "@/lib/trafego/acesso";
import { brl } from "@/lib/trafego/metricas";
import { dia, NOME_PLATAFORMA, PLATAFORMAS, type Plataforma } from "@/lib/trafego/tipos";
import { decidirRascunho } from "../campanhas/actions";
import { carregarWorkspace } from "../carregar";
import { decidir, pararTudo } from "../diretor/actions";
import {
  criarAutomaticamente, criarGuiada, decidirAcaoPendente, decidirIdeia, definirNivel, editarRascunho, mudarSituacao, pedirIdeias,
} from "./actions";

export const dynamic = "force-dynamic";
// Gerar uma campanha chama a IA e pode levar mais de um minuto.
export const maxDuration = 300;

const ERROS: Record<string, string> = {
  papel: "Só o dono ou um admin do workspace pode usar o Diretor de Tráfego.",
  "so-dono": "Só o dono do workspace pode aprovar, editar, recusar, ativar, retomar ou concluir campanhas.",
  recente: "A JUDITE acabou de atender um pedido. Aguarde um minuto para pedir outro.",
  proposta: "A JUDITE não montou a campanha:",
  ideias: "A JUDITE não trouxe ideias agora:",
  pedido: "Confira o pedido: orçamento entre R$ 1 e R$ 5.000 por dia e textos curtos.",
  edicao: "Confira os dados: nome (mínimo 3 letras), orçamento maior que zero e idades entre 18 e 65.",
  plataforma: "A ação não foi aplicada:",
  decisao: "Não foi possível registrar a decisão (talvez ela já tenha sido decidida).",
  execucao: "A decisão foi registrada, mas a mudança não pôde ser aplicada:",
  nivel: "O nível de autonomia não mudou:",
  migracao: "Para aprovar ou dispensar ações da autonomia por aqui, aplique antes a migração do Diretor de Tráfego no Supabase (veja docs/PENDENTE.md).",
  "migracao-nivel": "Para usar o nível 0 (manual), aplique antes a migração da CMO autônoma no Supabase (veja docs/PENDENTE.md).",
  autonomia: "Não foi possível mudar a autonomia.",
};
const AVISOS: Record<string, string> = {
  proposta: "A JUDITE montou a campanha. Ela está abaixo, em \"Para você avaliar\".",
  ideias: "A JUDITE trouxe ideias de campanha. Escolha uma para ela montar.",
  "ideia-descartada": "Ideia descartada.",
  editada: "Proposta atualizada.",
  recusada: "Recusado. Nada foi criado nem mudado.",
  publicada: "Campanha criada PAUSADA na plataforma. Para ligar, é preciso aprovar a ativação.",
  "publicada-simulada": "Aprovado em MODO SIMULADO: nada foi criado na plataforma. Agora você pode testar a ativação.",
  ativada: "Campanha ativada na plataforma.",
  "ativada-simulada": "Ativação simulada: nada mudou na plataforma.",
  pausar: "Campanha pausada.",
  retomar: "Campanha retomada.",
  concluir: "Campanha concluída.",
  aplicada: "Aprovado e aplicado na conta de anúncios.",
  dispensada: "Ação dispensada. Nada foi mudado.",
  aprovada: "Recomendação aprovada.",
  executada: "Recomendação aprovada e aplicada na plataforma.",
  "autonomia-desligada": "Autonomia desligada. A JUDITE voltou para o nível 1: só propõe.",
  "nivel-0": "Nível 0 (manual): a JUDITE só trabalha quando você pede.",
  "nivel-1": "Nível 1 (assistido): a JUDITE propõe todo dia e espera a sua aprovação.",
  "nivel-2": "Nível 2 (autonomia controlada): a JUDITE passa a ajustar a verba sozinha, dentro dos limites.",
};
const ROTULO_ACAO: Record<string, string> = {
  pausar: "Pausar campanha", ativar: "Ativar campanha", definir_orcamento: "Mudar orçamento diário", criar_campanha_pausada: "Propor campanha nova",
};
const ROTULO_STATUS_ACAO: Record<string, string> = {
  aplicada: "aplicada", erro: "erro", aguardando_aprovacao: "aguardando você", aprovada: "aprovada por você", dispensada: "dispensada",
};
const ROTULO_ETAPA: Record<string, string> = {
  monitoramento: "Monitoramento", coleta: "Coleta de dados", analise: "Análise", decisao: "Decisão", geracao: "Geração (IA)", conferencia: "Conferência", fila: "Fila de aprovação",
};
const ROTULO_ATOR: Record<string, string> = { pessoa: "pessoa", ia: "JUDITE", sistema: "sistema" };
const COR_ESTADO: Partial<Record<Estado, string>> = {
  ativa: "text-emerald-300", aprendizado: "text-emerald-300", otimizando: "text-emerald-300", pausada: "text-zinc-300", pausada_pela_ia: "text-amber-300",
};

const cartao = "rounded-xl border border-zinc-800 bg-zinc-900/60 p-4";
const campo = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100";
const rotulo = "space-y-1 text-xs text-zinc-400";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";
const aprovar = "rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-zinc-950";
const neutro = "rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300";
const etiqueta = "rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300";
const resumoDetalhes = "cursor-pointer text-sm text-amber-300 hover:text-amber-200";
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const DIAS_DA_FILA = 14;

type IdeiaDetalhes = Partial<{
  rotulo: string; canal: string; publico: string; estrategia: string; hipotese: string; por_que: string; metrica: string;
  confianca: string; dados: string[]; ressalvas: string[]; avisos: string[];
}>;
type EtapaGravada = { etapa: string; ok: boolean; detalhe: string; ms: number };

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
  const ws = workspace.id as string;
  const desde = dia(-DIAS_DA_FILA);

  const [rascunhosR, produtosR, criativosR, pendentesR, recomendacoesR, feitasR, autonomiaR, campanhasR, ideiasR, execucoesR] = await Promise.all([
    supabase.from("campanha_rascunhos").select("*").eq("workspace_id", ws)
      .not("status", "in", "(recusada,concluida,erro,rascunho)").order("criado_em", { ascending: false }).limit(40),
    supabase.from("produtos").select("id, nome").eq("workspace_id", ws).eq("ativo", true).order("nome"),
    supabase.from("criativos").select("id, titulo").eq("workspace_id", ws).limit(300),
    supabase.from("trafego_acoes").select("id, criado_em, plataforma, entidade_nome, acao, valor_antes, valor_depois, resultado")
      .eq("workspace_id", ws).eq("origem", "automacao").eq("status", "aguardando_aprovacao")
      .in("acao", ["pausar", "ativar", "definir_orcamento"]).gte("criado_em", desde).order("criado_em", { ascending: false }).limit(20),
    supabase.from("diretor_recomendacoes").select("*").eq("workspace_id", ws).eq("status", "proposta")
      .in("tipo", TIPOS_DE_VERBA).gte("criado_em", desde).order("criado_em", { ascending: false }).limit(10),
    supabase.from("trafego_acoes").select("id, criado_em, plataforma, entidade_nome, acao, valor_antes, valor_depois, status, resultado")
      .eq("workspace_id", ws).eq("origem", "automacao").order("criado_em", { ascending: false }).limit(12),
    supabase.from("autonomia").select("*").eq("workspace_id", ws).maybeSingle(),
    supabase.from("trafego_campanhas").select("plataforma, campanha_id, nome").eq("workspace_id", ws),
    supabase.from("campanha_ideias").select("*").eq("workspace_id", ws).eq("status", "nova").order("criado_em", { ascending: false }).limit(6),
    supabase.from("cmo_execucoes").select("iniciado_em, origem, modo, status, etapas, resultado").eq("workspace_id", ws)
      .order("iniciado_em", { ascending: false }).limit(3),
  ]);
  const semTabela = Boolean(rascunhosR.error);
  const semMigracaoCMO = Boolean(ideiasR.error);
  const rascunhos = rascunhosR.data ?? [];
  const propostas = rascunhos.filter((r) => r.status === "aguardando_aprovacao");
  const paraAtivar = rascunhos.filter((r) => r.status === "publicada_pausada");
  const emCurso = rascunhos.filter((r) => ehEstado(r.status) && (RODANDO.includes(r.status) || r.status === "pausada" || r.status === "pausada_pela_ia"));
  const produtos = produtosR.data ?? [];
  const pendentes = pendentesR.data ?? [];
  const recomendacoes = recomendacoesR.data ?? [];
  const feitas = feitasR.data ?? [];
  const ideias = ideiasR.data ?? [];
  const execucoes = execucoesR.data ?? [];
  const nivel = nivelEfetivo(autonomiaR.data);
  const totalFila = propostas.length + paraAtivar.length + pendentes.length + recomendacoes.length;

  const idsComHistorico = [...propostas, ...paraAtivar, ...emCurso].map((r) => r.id as string);
  const { data: eventos } = idsComHistorico.length
    ? await supabase.from("campanha_eventos").select("rascunho_id, criado_em, de, para, ator, motivo")
      .eq("workspace_id", ws).in("rascunho_id", idsComHistorico).order("criado_em", { ascending: true }).limit(300)
    : { data: [] };

  const tituloCriativo = (id: string) => criativosR.data?.find((c) => c.id === id)?.titulo ?? "criativo";
  const nomeProduto = (id: unknown) => produtos.find((p) => p.id === id)?.nome ?? "";
  const nomeCampanha = (p: string | null, id: string | null) =>
    campanhasR.data?.find((c) => c.campanha_id === id && (!p || c.plataforma === p))?.nome || id || "";
  const plataforma = (p: unknown) => NOME_PLATAFORMA[p as Plataforma] ?? String(p ?? "");
  const estado = (s: unknown) => (ehEstado(s) ? ROTULO_ESTADO[s] : String(s ?? ""));
  const mudanca = (a: { acao: unknown; valor_antes: unknown; valor_depois: unknown }) =>
    a.acao === "definir_orcamento"
      ? ` de ${brl(a.valor_antes === null ? null : Number(a.valor_antes))} para ${brl(Number(a.valor_depois ?? 0))} por dia`
      : a.acao === "criar_campanha_pausada" ? ` com ${brl(Number(a.valor_depois ?? 0))} por dia` : "";
  const historicoDe = (id: unknown) => (eventos ?? []).filter((e) => e.rascunho_id === id);

  const historico = (id: unknown) => {
    const linhas = historicoDe(id);
    if (!linhas.length) return null;
    return (
      <details>
        <summary className={resumoDetalhes}>Histórico ({linhas.length})</summary>
        <ul className="mt-2 space-y-1 text-xs text-zinc-400">
          {linhas.map((e, n) => (
            <li key={n}>
              <span className="text-zinc-500">{quando(e.criado_em as string)}</span> · {ROTULO_ATOR[e.ator as string] ?? e.ator} ·{" "}
              {e.de && e.de !== e.para ? `${estado(e.de)} → ` : ""}<span className="text-zinc-200">{estado(e.para)}</span>
              {e.motivo ? <span className="block text-zinc-500">{e.motivo as string}</span> : null}
            </li>
          ))}
        </ul>
      </details>
    );
  };

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6">
      <header>
        <h1 className="font-serif text-3xl">Diretor de Tráfego</h1>
        <p className="max-w-3xl text-sm text-zinc-500">
          A JUDITE encontra a oportunidade, monta a estratégia, escreve os anúncios, escolhe o público e propõe o orçamento.
          Você avalia. Nenhuma campanha é criada e nenhum real a mais é gasto sem a sua aprovação.
        </p>
      </header>

      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}{motivo ? ` ${motivo}` : ""}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</p>}

      {/* ---------------------------------------------------------------- Situação */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className={cartao + " space-y-1 text-sm"}>
          <p className="text-xs text-zinc-500">IA</p>
          <p className={temChave ? "text-emerald-300" : "text-amber-300"}>
            {temChave ? `Conectada: ${PROVEDORES_IA[provedorEscolhido()].nome}` : "Não configurada"}
          </p>
          <p className="text-xs text-zinc-500">
            {temChave
              ? "A chave fica só no servidor. Se o provedor recusar um pedido, o motivo aparece aqui na tela."
              : <>Falta a variável <code className="font-mono">{PROVEDORES_IA[provedorParaConfigurar()].variavel}</code>. Sem ela a JUDITE não cria campanhas nem ideias. O passo a passo está na página <Link href={`${base}/diretor`} className="underline">Diretor</Link>.</>}
          </p>
        </div>
        <div className={cartao + " space-y-1 text-sm"}>
          <p className="text-xs text-zinc-500">Autonomia</p>
          <p className={nivel >= 2 ? "text-emerald-300" : "text-zinc-200"}>Nível {nivel}: {NIVEIS[nivel].nome}</p>
          {nivel >= 2 && gestor ? (
            <form action={pararTudo}>
              <Ocultos ws={ws} campos={{}} />
              <BotaoEnviar className="mt-1 rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white" aguarde="Parando...">Parar tudo</BotaoEnviar>
            </form>
          ) : <p className="text-xs text-zinc-500">{NIVEIS[nivel].resumo}</p>}
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
      {!semTabela && semMigracaoCMO && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          Falta aplicar a migração da CMO autônoma no Supabase (veja docs/PENDENTE.md). Até lá a JUDITE cria campanhas, mas não guarda o plano
          completo, o histórico, as ideias nem o registro do ciclo diário.
        </p>
      )}
      {!semTabela && !produtos.length && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          Para a JUDITE criar campanhas, cadastre pelo menos um produto no{" "}
          <Link href={`${base}/criativos`} className="underline">Creative Studio</Link> (nome, preço e os fatos do passeio). Ela só usa o que estiver cadastrado.
        </p>
      )}

      {/* ---------------------------------------------------------------- Criar */}
      {gestor && !semTabela && (
        <section className="space-y-3">
          <h2 className="font-serif text-xl">Criar campanha</h2>
          <div className="grid gap-3 lg:grid-cols-3">
            <form action={criarAutomaticamente} className={cartao + " flex flex-col gap-3"}>
              <input type="hidden" name="workspaceId" value={ws} />
              <div>
                <h3 className="font-medium text-zinc-100">Criar automaticamente</h3>
                <p className="text-xs text-zinc-500">Escolha o produto. A JUDITE decide canal, objetivo, público, orçamento e escreve os anúncios.</p>
              </div>
              <label className={rotulo}>Produto
                <select name="produtoId" className={campo} defaultValue="">
                  <option value="">A JUDITE escolhe</option>
                  {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
              <div className="mt-auto">
                {temChave && produtos.length > 0
                  ? <BotaoEnviar className={botao} aguarde="Montando... (até 1 minuto)">Criar automaticamente</BotaoEnviar>
                  : <p className="text-xs text-amber-200">{temChave ? "Cadastre um produto primeiro." : "Falta a chave da IA."}</p>}
              </div>
            </form>

            <form action={pedirIdeias} className={cartao + " flex flex-col gap-3"}>
              <input type="hidden" name="workspaceId" value={ws} />
              <div>
                <h3 className="font-medium text-zinc-100">Quero ideias</h3>
                <p className="text-xs text-zinc-500">
                  Ela analisa produtos, campanhas, site e vendas e traz até 3 ideias, com o porquê de cada uma. Você escolhe qual virar campanha.
                </p>
              </div>
              <div className="mt-auto">
                {temChave && produtos.length > 0 && !semMigracaoCMO
                  ? <BotaoEnviar className={botao} aguarde="Analisando... (até 1 minuto)">Quero ideias</BotaoEnviar>
                  : <p className="text-xs text-amber-200">{!temChave ? "Falta a chave da IA." : !produtos.length ? "Cadastre um produto primeiro." : "Falta a migração da CMO autônoma."}</p>}
              </div>
            </form>

            <details className={cartao}>
              <summary className="cursor-pointer">
                <span className="font-medium text-zinc-100">Criar campanha</span>
                <span className="block text-xs text-zinc-500">Responda só o que souber. O que ficar em branco a JUDITE decide.</span>
              </summary>
              <form action={criarGuiada} className="mt-3 grid gap-3">
                <input type="hidden" name="workspaceId" value={ws} />
                <label className={rotulo}>Qual produto ou serviço?
                  <select name="produtoId" className={campo} defaultValue="">
                    <option value="">A JUDITE escolhe</option>
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </label>
                <label className={rotulo}>Qual objetivo?
                  <select name="objetivo" className={campo} defaultValue="">
                    <option value="">A JUDITE escolhe</option>
                    {OBJETIVOS.map((o) => <option key={o} value={o}>{ROTULO_OBJETIVO[o]}</option>)}
                  </select>
                </label>
                <label className={rotulo}>Qual plataforma?
                  <select name="plataforma" className={campo} defaultValue="">
                    <option value="">A JUDITE escolhe</option>
                    {PLATAFORMAS.map((p) => <option key={p} value={p}>{NOME_PLATAFORMA[p]}</option>)}
                  </select>
                </label>
                <label className={rotulo}>Orçamento aproximado por dia (R$)
                  <input name="orcamento" type="number" min={1} max={5000} step="0.01" placeholder="A JUDITE calcula" className={campo} />
                </label>
                <label className={rotulo}>Público, se você já conhece
                  <input name="publico" maxLength={300} placeholder="Ex.: casais de 30 a 50 anos que viajam" className={campo} />
                </label>
                <label className={rotulo}>Região
                  <input name="regiao" maxLength={200} placeholder="Ex.: São Luís e capitais do Nordeste" className={campo} />
                </label>
                <label className={rotulo}>Alguma observação?
                  <input name="observacao" maxLength={300} className={campo} />
                </label>
                {temChave && produtos.length > 0
                  ? <BotaoEnviar className={botao} aguarde="Montando... (até 1 minuto)">Criar campanha</BotaoEnviar>
                  : <p className="text-xs text-amber-200">{temChave ? "Cadastre um produto primeiro." : "Falta a chave da IA."}</p>}
              </form>
            </details>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- Ideias */}
      {ideias.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-serif text-xl">Ideias da JUDITE</h2>
          <div className="grid gap-3 lg:grid-cols-3">
            {ideias.map((i, n) => {
              const d = (i.detalhes ?? {}) as IdeiaDetalhes;
              return (
                <article key={i.id} className={cartao + " flex flex-col gap-2 text-sm"}>
                  <p className="text-xs text-zinc-500">Ideia {n + 1} · {nomeProduto(i.produto_id) || "produto"}</p>
                  <h3 className="font-medium text-zinc-100">{i.titulo}</h3>
                  <dl className="space-y-1 text-xs text-zinc-400">
                    <div><dt className="inline text-zinc-500">Objetivo: </dt><dd className="inline">{ROTULO_OBJETIVO[i.objetivo as Objetivo] ?? i.objetivo}</dd></div>
                    <div><dt className="inline text-zinc-500">Canal: </dt><dd className="inline">{plataforma(i.plataforma)}</dd></div>
                    {d.publico && <div><dt className="inline text-zinc-500">Público: </dt><dd className="inline">{d.publico}</dd></div>}
                    {d.estrategia && <div><dt className="inline text-zinc-500">Estratégia: </dt><dd className="inline">{d.estrategia}</dd></div>}
                    {d.hipotese && <div><dt className="inline text-zinc-500">Hipótese: </dt><dd className="inline">{d.hipotese}</dd></div>}
                    <div><dt className="inline text-zinc-500">Orçamento sugerido: </dt><dd className="inline">{i.orcamento_sugerido ? `${brl(Number(i.orcamento_sugerido))} por dia` : "sem folga no mês"}</dd></div>
                    {d.metrica && <div><dt className="inline text-zinc-500">Métrica principal: </dt><dd className="inline">{d.metrica}</dd></div>}
                    {d.confianca && <div><dt className="inline text-zinc-500">Confiança: </dt><dd className={"inline " + (COR_NIVEL[d.confianca] ?? "")}>{ROTULO_NIVEL[d.confianca] ?? d.confianca}</dd></div>}
                  </dl>
                  {d.por_que && <p className="text-zinc-300"><span className="text-zinc-500">Por que: </span>{d.por_que}</p>}
                  {(d.avisos ?? []).map((a, k) => <p key={k} className="text-xs text-amber-200">{a}</p>)}
                  <div className="mt-auto flex flex-wrap gap-2 pt-1">
                    <form action={decidirIdeia}>
                      <Ocultos ws={ws} campos={{ ideiaId: i.id as string, decisao: "gerar" }} />
                      <BotaoEnviar className={aprovar} aguarde="Montando...">Gerar campanha</BotaoEnviar>
                    </form>
                    <form action={decidirIdeia}>
                      <Ocultos ws={ws} campos={{ ideiaId: i.id as string, decisao: "descartar" }} />
                      <BotaoEnviar className={neutro} aguarde="...">Descartar</BotaoEnviar>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="text-xs text-zinc-500">Gerar campanha só coloca a proposta na fila abaixo. Nada é criado na plataforma.</p>
        </section>
      )}

      {/* ---------------------------------------------------------------- Fila */}
      <section className="space-y-3">
        <h2 className="font-serif text-xl">Para você avaliar {totalFila > 0 && <span className="text-amber-300">({totalFila})</span>}</h2>

        {propostas.map((r) => {
          const publico = (r.publico ?? {}) as Partial<Publico>;
          const avisos = [...((r.avisos ?? []) as string[]), ...(lerPlano(r.plano)?.avisos ?? [])];
          const ids = (r.criativo_ids ?? []) as string[];
          const plano = lerPlano(r.plano);
          return (
            <article key={r.id} className={cartao + " space-y-2 text-sm"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={etiqueta}>Campanha nova</span>
                <span className="text-xs text-zinc-500">
                  {r.origem === "diretor" ? "proposta pela JUDITE" : "montada à mão"} em {quando(r.criado_em as string)}
                  {nomeProduto(r.produto_id) ? ` · ${nomeProduto(r.produto_id)}` : ""}
                </span>
              </div>
              <h3 className="text-base font-medium text-zinc-100">{r.nome}</h3>
              <p className="text-zinc-400">
                <span className="text-zinc-500">O que ela quer fazer: </span>
                criar uma campanha em {plataforma(r.plataforma)} para {(ROTULO_OBJETIVO[r.objetivo as Objetivo] ?? String(r.objetivo)).toLowerCase()},
                com <strong className="text-zinc-200">{brl(Number(r.orcamento_diario))} por dia</strong>.
              </p>
              {r.justificativa && <p className="text-zinc-300"><span className="text-zinc-500">Por quê: </span>{r.justificativa}</p>}
              {plano && (
                <p className="text-xs text-zinc-400">
                  Risco: <span className={COR_NIVEL[plano.risco]}>{ROTULO_NIVEL[plano.risco]}</span>
                  {" · "}Confiança: <span className={COR_NIVEL[plano.confianca]}>{ROTULO_NIVEL[plano.confianca]}</span>
                  {" · "}Impacto esperado: {plano.impacto_esperado}
                </p>
              )}
              <p className="text-xs text-zinc-500">
                Público: {[publico.regiao, publico.idade_min || publico.idade_max ? `${publico.idade_min ?? 18} a ${publico.idade_max ?? 65} anos` : "", publico.interesses]
                  .filter(Boolean).join(" · ") || "não informado"}
                {!plano && ids.length > 0 && <> · Criativos: {ids.map(tituloCriativo).join("; ")}</>}
              </p>
              {avisos.length > 0 && (
                <ul className="list-disc space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 py-2 pl-7 pr-3 text-xs text-amber-100">
                  {avisos.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              )}

              {dono ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <form action={decidirRascunho}>
                    <Ocultos ws={ws} campos={{ rascunhoId: r.id as string, decisao: "aprovar" }} />
                    <BotaoEnviar className={aprovar} aguarde="Criando...">{real ? "Aprovar e criar pausada" : "Aprovar (simulado)"}</BotaoEnviar>
                  </form>
                  <form action={decidirRascunho}>
                    <Ocultos ws={ws} campos={{ rascunhoId: r.id as string, decisao: "recusar" }} />
                    <BotaoEnviar className={neutro} aguarde="Salvando...">Recusar</BotaoEnviar>
                  </form>
                </div>
              ) : <p className="text-xs text-zinc-500">Só o dono do workspace aprova campanhas novas.</p>}

              {plano && (
                <details>
                  <summary className={resumoDetalhes}>Ver detalhes</summary>
                  <div className="mt-2"><DetalhesDoPlano plano={plano} /></div>
                </details>
              )}
              {dono && (
                <details>
                  <summary className={resumoDetalhes}>Editar</summary>
                  <form action={editarRascunho} className="mt-2 grid gap-3 sm:grid-cols-2">
                    <Ocultos ws={ws} campos={{ rascunhoId: r.id as string }} />
                    <label className={rotulo + " sm:col-span-2"}>Nome da campanha
                      <input name="nome" required minLength={3} maxLength={150} defaultValue={r.nome as string} className={campo} />
                    </label>
                    <label className={rotulo}>Orçamento por dia (R$)
                      <input name="orcamento" type="number" required min={1} max={5000} step="0.01" defaultValue={Number(r.orcamento_diario)} className={campo} />
                    </label>
                    <label className={rotulo}>Região
                      <input name="regiao" maxLength={200} defaultValue={publico.regiao ?? ""} className={campo} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className={rotulo}>Idade de
                        <input name="idadeMin" type="number" min={18} max={65} defaultValue={publico.idade_min ?? ""} className={campo} />
                      </label>
                      <label className={rotulo}>até
                        <input name="idadeMax" type="number" min={18} max={65} defaultValue={publico.idade_max ?? ""} className={campo} />
                      </label>
                    </div>
                    <label className={rotulo}>Interesses
                      <input name="interesses" maxLength={500} defaultValue={publico.interesses ?? ""} className={campo} />
                    </label>
                    <div className="sm:col-span-2"><BotaoEnviar className={neutro} aguarde="Conferindo...">Salvar mudanças</BotaoEnviar></div>
                  </form>
                </details>
              )}
              {historico(r.id)}
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
            <p className="text-zinc-400">
              <span className="text-zinc-500">O que ela quer fazer: </span>ligar a campanha em {plataforma(r.plataforma)}, gastando {brl(Number(r.orcamento_diario))} por dia.
            </p>
            {!r.simulada && (
              <p className="text-xs text-zinc-500">Antes de ligar, finalize o público e os anúncios na plataforma, seguindo a proposta. Ligar faz a campanha começar a gastar.</p>
            )}
            {dono ? (
              <div className="flex flex-wrap gap-2">
                <form action={decidirRascunho}>
                  <Ocultos ws={ws} campos={{ rascunhoId: r.id as string, decisao: "ativar" }} />
                  <BotaoEnviar className="rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-medium text-zinc-950" aguarde="Ativando...">
                    {r.simulada ? "Aprovar ativação (simulado)" : "Aprovar ativação (começa a gastar)"}
                  </BotaoEnviar>
                </form>
                <form action={mudarSituacao}>
                  <Ocultos ws={ws} campos={{ rascunhoId: r.id as string, acao: "concluir" }} />
                  <BotaoEnviar className={neutro} aguarde="...">Não ligar (concluir)</BotaoEnviar>
                </form>
              </div>
            ) : <p className="text-xs text-zinc-500">Só o dono do workspace ativa campanhas.</p>}
            {lerPlano(r.plano) && (
              <details>
                <summary className={resumoDetalhes}>Ver detalhes</summary>
                <div className="mt-2"><DetalhesDoPlano plano={lerPlano(r.plano)!} /></div>
              </details>
            )}
            {historico(r.id)}
          </article>
        ))}

        {pendentes.map((a) => (
          <article key={a.id} className={cartao + " space-y-2 text-sm"}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={etiqueta}>{ROTULO_ACAO[a.acao as string] ?? a.acao}</span>
              <span className="text-xs text-zinc-500">a autonomia quis fazer em {quando(a.criado_em as string)}, mas passou de um limite</span>
            </div>
            <h3 className="text-base font-medium text-zinc-100">{a.entidade_nome}</h3>
            <p className="text-zinc-400"><span className="text-zinc-500">O que ela quer fazer: </span>{(ROTULO_ACAO[a.acao as string] ?? String(a.acao)).toLowerCase()} em {plataforma(a.plataforma)}{mudanca(a)}.</p>
            {a.resultado && <p className="text-zinc-300"><span className="text-zinc-500">Por quê: </span>{String(a.resultado).slice(0, 400)}</p>}
            {gestor && (
              <div className="flex flex-wrap gap-2 pt-1">
                <form action={decidirAcaoPendente}>
                  <Ocultos ws={ws} campos={{ acaoId: a.id as string, decisao: "aprovar" }} />
                  <BotaoEnviar className={aprovar} aguarde="Aplicando...">Aprovar e aplicar na conta</BotaoEnviar>
                </form>
                <form action={decidirAcaoPendente}>
                  <Ocultos ws={ws} campos={{ acaoId: a.id as string, decisao: "dispensar" }} />
                  <BotaoEnviar className={neutro} aguarde="Salvando...">Dispensar</BotaoEnviar>
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
            <p className="text-zinc-300"><span className="text-zinc-500">Por quê: </span>{r.justificativa}</p>
            {r.impacto_esperado && <p className="text-zinc-400"><span className="text-zinc-500">Impacto esperado: </span>{r.impacto_esperado}</p>}
            {gestor && (
              <div className="flex flex-wrap gap-2 pt-1">
                <form action={decidir}>
                  <Ocultos ws={ws} campos={{ recomendacaoId: r.id as string, decisao: "aprovar" }} />
                  <BotaoEnviar className={aprovar} aguarde="Aplicando...">Aprovar e aplicar na conta</BotaoEnviar>
                </form>
                <form action={decidir}>
                  <Ocultos ws={ws} campos={{ recomendacaoId: r.id as string, decisao: "recusar" }} />
                  <BotaoEnviar className={neutro} aguarde="Salvando...">Recusar</BotaoEnviar>
                </form>
              </div>
            )}
          </article>
        ))}

        {totalFila === 0 && (
          <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">
            Nada esperando por você agora.{" "}
            {nivel >= 1 && temChave ? "O próximo ciclo automático roda amanhã cedo." : nivel === 0 ? "No nível manual a JUDITE só propõe quando você pede." : ""}
          </p>
        )}
        <p className="text-xs text-zinc-500">
          Recomendações que não mexem em verba (site, criativos, perfil no Google) ficam no relatório da página{" "}
          <Link href={`${base}/diretor`} className="underline">Diretor</Link>. Campanhas recusadas e concluídas estão em{" "}
          <Link href={`${base}/campanhas`} className="underline">Campanhas</Link>.
        </p>
      </section>

      {/* ---------------------------------------------------------------- Campanhas em curso */}
      {emCurso.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-serif text-xl">Campanhas da JUDITE em andamento</h2>
          {emCurso.map((r) => {
            const s = r.status as Estado;
            const proximos = proximosEstados(s);
            return (
              <article key={r.id} className={cartao + " space-y-2 text-sm"}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-medium text-zinc-100">{r.nome}</h3>
                  <span className={"text-xs " + (COR_ESTADO[s] ?? "text-zinc-300")}>{ROTULO_ESTADO[s]}{r.simulada ? " · SIMULADA" : ""}</span>
                </div>
                <p className="text-zinc-400">{plataforma(r.plataforma)} · {brl(Number(r.orcamento_diario))} por dia{r.resultado ? ` · ${r.resultado}` : ""}</p>
                <div className="flex flex-wrap gap-2">
                  {gestor && proximos.includes("pausada") && (
                    <form action={mudarSituacao}>
                      <Ocultos ws={ws} campos={{ rascunhoId: r.id as string, acao: "pausar" }} />
                      <BotaoEnviar className={neutro} aguarde="Pausando...">Pausar</BotaoEnviar>
                    </form>
                  )}
                  {dono && proximos.includes("ativa") && (
                    <form action={mudarSituacao}>
                      <Ocultos ws={ws} campos={{ rascunhoId: r.id as string, acao: "retomar" }} />
                      <BotaoEnviar className={neutro} aguarde="Retomando...">{r.simulada ? "Retomar (simulado)" : "Retomar (volta a gastar)"}</BotaoEnviar>
                    </form>
                  )}
                  {dono && proximos.includes("concluida") && (
                    <form action={mudarSituacao}>
                      <Ocultos ws={ws} campos={{ rascunhoId: r.id as string, acao: "concluir" }} />
                      <BotaoEnviar className={neutro} aguarde="Concluindo...">Concluir</BotaoEnviar>
                    </form>
                  )}
                </div>
                {lerPlano(r.plano) && (
                  <details>
                    <summary className={resumoDetalhes}>Ver detalhes</summary>
                    <div className="mt-2"><DetalhesDoPlano plano={lerPlano(r.plano)!} /></div>
                  </details>
                )}
                {historico(r.id)}
              </article>
            );
          })}
        </section>
      )}

      {/* ---------------------------------------------------------------- Autonomia */}
      <section className="space-y-3">
        <h2 className="font-serif text-xl">Nível de autonomia</h2>
        <form action={definirNivel} className={cartao + " space-y-3 text-sm"}>
          <input type="hidden" name="workspaceId" value={ws} />
          <div className="space-y-2">
            {([0, 1, 2, 3, 4] as Nivel[]).map((n) => (
              <label key={n} className={"flex items-start gap-3 rounded-lg border p-3 " + (n === nivel ? "border-amber-400/60 bg-amber-400/5" : "border-zinc-800") + (NIVEIS[n].disponivel ? "" : " opacity-50")}>
                <input type="radio" name="nivel" value={n} defaultChecked={n === nivel} disabled={!dono || !NIVEIS[n].disponivel} className="mt-1" />
                <span>
                  <span className="font-medium text-zinc-100">Nível {n} · {NIVEIS[n].nome}</span>
                  {n === nivel && <span className="ml-2 text-xs text-amber-300">atual</span>}
                  <span className="block text-xs text-zinc-400">{NIVEIS[n].resumo}</span>
                </span>
              </label>
            ))}
          </div>
          {dono ? (
            <>
              <label className="flex items-start gap-2 text-xs text-zinc-400">
                <input type="checkbox" name="ciente" value="sim" className="mt-0.5" />
                <span>
                  Para o nível 2: li as regras da autonomia na página <Link href={`${base}/diretor`} className="underline">Diretor</Link> e quero que a JUDITE
                  possa pausar campanhas e ajustar verbas sozinha, dentro dos Limites da IA.
                </span>
              </label>
              <BotaoEnviar className={botao} aguarde="Salvando...">Salvar nível</BotaoEnviar>
            </>
          ) : <p className="text-xs text-zinc-500">Só o dono do workspace muda o nível de autonomia.</p>}
          <p className="text-xs text-zinc-500">
            Em qualquer nível: campanha nova e ativação sempre pedem a sua aprovação, e os tetos de gasto ficam em{" "}
            <Link href={base} className="underline">Visão geral → Limites da IA</Link>. No máximo {MAX_PROPOSTAS_PENDENTES} propostas automáticas esperam você ao mesmo tempo.
          </p>
        </form>
      </section>

      {/* ---------------------------------------------------------------- Ciclo */}
      <section className="space-y-3">
        <h2 className="font-serif text-xl">Como a JUDITE trabalhou</h2>
        {execucoes.length > 0 ? execucoes.map((x, n) => (
          <details key={n} className={cartao + " text-sm"} open={n === 0}>
            <summary className="cursor-pointer">
              <span className="text-zinc-200">{quando(x.iniciado_em as string)}</span>
              <span className="text-zinc-500"> · {x.origem === "cron" ? "ciclo automático" : "a seu pedido"} · </span>
              <span className={x.status === "ok" ? "text-emerald-300" : x.status === "erro" ? "text-rose-300" : "text-zinc-300"}>
                {x.status === "ok" ? "proposta criada" : x.status === "sem_proposta" ? "sem proposta" : x.status === "erro" ? "erro" : "rodando"}
              </span>
              {x.resultado ? <span className="block text-xs text-zinc-500">{x.resultado as string}</span> : null}
            </summary>
            <ol className="mt-2 space-y-1 text-xs">
              {((x.etapas ?? []) as EtapaGravada[]).map((e, k) => (
                <li key={k} className="text-zinc-400">
                  <span className={e.ok ? "text-emerald-300" : "text-rose-300"}>{e.ok ? "✓" : "✗"}</span>{" "}
                  <span className="text-zinc-200">{ROTULO_ETAPA[e.etapa] ?? e.etapa}</span>: {e.detalhe} <span className="text-zinc-600">({e.ms} ms)</span>
                </li>
              ))}
            </ol>
          </details>
        )) : (
          <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">
            {semMigracaoCMO ? "O registro de cada etapa aparece aqui depois da migração da CMO autônoma." : "Nenhuma execução registrada ainda."}
          </p>
        )}
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">Quem faz o quê (agentes da CMO)</summary>
          <ul className="mt-2 space-y-1">
            {AGENTES.map((a) => (
              <li key={a.id}>
                <span className="text-zinc-300">{a.nome}</span> · {a.tipo === "ia" ? "IA" : a.tipo === "regras" ? "regras fixas sobre os dados" : "ainda não participa das campanhas"} · {a.papel}
              </li>
            ))}
          </ul>
        </details>
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
