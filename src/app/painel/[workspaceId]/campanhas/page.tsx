/**
 * Campaign Manager: rascunho de campanha (montado pelo Diretor ou à mão) -> aprovação do dono ->
 * campanha criada PAUSADA -> ativação, que é outra aprovação. No modo simulado (padrão) nada é
 * criado nas plataformas: o fluxo acontece só dentro da JUDITE.
 */

import { BotaoEnviar } from "@/components/BotaoEnviar";
import { OBJETIVOS, publicacaoReal, ROTULO_OBJETIVO, type Objetivo, type Publico } from "@/lib/campanhas/rascunho";
import { ROTULO_ESTADO } from "@/lib/cmo/estados";
import { iaConfigurada, PROVEDORES_IA, provedorParaConfigurar } from "@/lib/ia";
import { podeAgir } from "@/lib/trafego/acesso";
import { brl } from "@/lib/trafego/metricas";
import { NOME_PLATAFORMA, PLATAFORMAS, type Plataforma } from "@/lib/trafego/tipos";
import { carregarWorkspace } from "../carregar";
import { criarRascunho, decidirRascunho, pedirRascunhoAoDiretor } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ERROS: Record<string, string> = {
  papel: "Só o dono ou um admin pode montar rascunhos de campanha.",
  "so-dono": "Só o dono do workspace pode aprovar, recusar ou ativar campanhas.",
  rascunho: "Confira os dados do rascunho: nome (mínimo 3 letras), orçamento maior que zero e idades entre 18 e 65.",
  conferencia: "O rascunho não passou na conferência:",
  "sem-chave": "Falta a chave da IA ({variavel}). Veja a explicação na página Diretor. Você ainda pode montar o rascunho à mão.",
  produto: "Escolha um produto cadastrado no Creative Studio.",
  recente: "O Diretor acabou de montar um rascunho. Aguarde um minuto para pedir outro.",
  ia: "O Diretor não conseguiu montar o rascunho.",
  plataforma: "A ação não foi aplicada:",
};
const AVISOS: Record<string, string> = {
  rascunho: "Rascunho salvo. Ele aguarda a aprovação do dono.",
  "rascunho-ia": "O Diretor montou um rascunho. Ele aguarda a aprovação do dono.",
  recusada: "Rascunho recusado. Nada foi criado.",
  publicada: "Campanha criada PAUSADA na plataforma. Para ligar, é preciso aprovar a ativação.",
  "publicada-simulada": "Aprovado em MODO SIMULADO: nada foi criado na plataforma. Agora você pode testar a ativação.",
  ativada: "Campanha ativada na plataforma.",
  "ativada-simulada": "Ativação simulada: nada mudou na plataforma.",
};
const ROTULO_STATUS: Record<string, string> = { ...ROTULO_ESTADO, publicada_pausada: "criada e pausada (aguardando ativação)" };
const COR_STATUS: Record<string, string> = {
  aguardando_aprovacao: "text-amber-300", publicada_pausada: "text-sky-300", ativa: "text-emerald-300", aprendizado: "text-emerald-300",
  otimizando: "text-emerald-300", pausada_pela_ia: "text-amber-300", recusada: "text-zinc-400", concluida: "text-zinc-400", erro: "text-rose-300",
};

const campo = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";
const cartao = "rounded-xl border border-zinc-800 bg-zinc-900/60 p-4";
const rotulo = "space-y-1 text-xs text-zinc-400";
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function CampanhasPage(props: PageProps<"/painel/[workspaceId]/campanhas">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const gestor = podeAgir(papel);
  const dono = papel === "owner";
  const params = await props.searchParams;
  const motivo = typeof params.motivo === "string" ? params.motivo.slice(0, 200) : "";
  const variavelIA = PROVEDORES_IA[provedorParaConfigurar()].variavel;
  const erro = typeof params.erro === "string" ? ERROS[params.erro]?.replace("{variavel}", variavelIA) : undefined;
  const aviso = typeof params.aviso === "string" ? AVISOS[params.aviso] : undefined;
  const real = publicacaoReal();
  const temChave = iaConfigurada();

  const [rascunhosR, produtosR, criativosR] = await Promise.all([
    supabase.from("campanha_rascunhos").select("*").eq("workspace_id", workspace.id).order("criado_em", { ascending: false }).limit(30),
    supabase.from("produtos").select("id, nome").eq("workspace_id", workspace.id).eq("ativo", true).order("nome"),
    supabase.from("criativos").select("id, titulo, formato, plataforma, status").eq("workspace_id", workspace.id).eq("status", "aprovado")
      .order("criado_em", { ascending: false }).limit(40),
  ]);
  const semTabela = Boolean(rascunhosR.error);
  const rascunhos = rascunhosR.data ?? [];
  const produtos = produtosR.data ?? [];
  const criativos = criativosR.data ?? [];
  const tituloCriativo = (id: string) => criativos.find((c) => c.id === id)?.titulo ?? "criativo";

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
      <header>
        <h1 className="font-serif text-3xl">Campanhas</h1>
        <p className="text-sm text-zinc-500">
          A JUDITE monta o rascunho; você aprova. Toda campanha nasce pausada, e ligar é uma segunda aprovação.
        </p>
      </header>

      <p className={"rounded-xl border p-4 text-sm " + (real ? "border-rose-500/40 bg-rose-500/10 text-rose-100" : "border-sky-500/40 bg-sky-500/10 text-sky-100")}>
        {real ? (
          <><strong>Modo real ligado.</strong> Ao aprovar, a campanha é criada de verdade na plataforma (sempre pausada). Ativar faz a campanha gastar dinheiro.</>
        ) : (
          <><strong>Modo simulado.</strong> Aprovar e ativar acontecem só dentro da JUDITE: nada é criado nem ligado nas plataformas.
            Para valer de verdade, o dono precisa definir a variável <code className="font-mono text-xs">JUDITE_PUBLICACAO_REAL=1</code> na Vercel.</>
        )}
      </p>

      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}{motivo ? ` ${motivo}` : ""}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</p>}
      {semTabela && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          A tabela de rascunhos ainda não existe no banco. Aplique as migrações das Etapas 8 e 9 no Supabase (veja docs/PENDENTE.md) e recarregue.
        </p>
      )}

      {!semTabela && gestor && (
        <section className="grid gap-3 lg:grid-cols-2">
          <div className={cartao + " space-y-3"}>
            <h2 className="font-serif text-lg">Pedir um rascunho ao Diretor</h2>
            <p className="text-xs text-zinc-500">
              A JUDITE analisa os dados reais do workspace e monta a campanha completa para o produto. As outras formas de criar (ideias, perguntas) estão no Diretor de Tráfego.
            </p>
            {!temChave && <p className="text-xs text-amber-200">Falta a chave da IA ({variavelIA}). Use o formulário ao lado para montar à mão.</p>}
            {!produtos.length && <p className="text-xs text-amber-200">Cadastre um produto no Creative Studio primeiro.</p>}
            <form action={pedirRascunhoAoDiretor} className="space-y-3">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <label className={rotulo}>Produto
                <select name="produtoId" required className={campo} defaultValue="">
                  <option value="" disabled>Escolha</option>
                  {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
              <label className={rotulo}>Orientação (opcional)
                <input name="orientacao" maxLength={300} placeholder="Ex.: quero mais conversas no WhatsApp" className={campo} />
              </label>
              <BotaoEnviar className={botao} aguarde="Montando... (pode levar 1 minuto)">Pedir rascunho</BotaoEnviar>
            </form>
          </div>

          <details className={cartao}>
            <summary className="cursor-pointer font-serif text-lg">Montar um rascunho à mão</summary>
            <form action={criarRascunho} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <label className={rotulo + " sm:col-span-2"}>Nome da campanha
                <input name="nome" required minLength={3} maxLength={150} className={campo} />
              </label>
              <label className={rotulo}>Plataforma
                <select name="plataforma" className={campo} defaultValue="facebook">
                  {PLATAFORMAS.map((p) => <option key={p} value={p}>{NOME_PLATAFORMA[p]}</option>)}
                </select>
              </label>
              <label className={rotulo}>Objetivo
                <select name="objetivo" className={campo} defaultValue="trafego">
                  {OBJETIVOS.map((o) => <option key={o} value={o}>{ROTULO_OBJETIVO[o]}</option>)}
                </select>
              </label>
              <label className={rotulo}>Orçamento por dia (R$)
                <input name="orcamento" type="number" required min={1} max={5000} step="0.01" className={campo} />
              </label>
              <label className={rotulo}>Produto
                <select name="produtoId" className={campo} defaultValue="">
                  <option value="">Nenhum</option>
                  {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
              <label className={rotulo}>Região do público
                <input name="regiao" maxLength={200} className={campo} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className={rotulo}>Idade de
                  <input name="idadeMin" type="number" min={18} max={65} className={campo} />
                </label>
                <label className={rotulo}>até
                  <input name="idadeMax" type="number" min={18} max={65} className={campo} />
                </label>
              </div>
              <label className={rotulo + " sm:col-span-2"}>Interesses do público
                <input name="interesses" maxLength={500} className={campo} />
              </label>
              {criativos.length > 0 && (
                <fieldset className="space-y-1 text-xs text-zinc-400 sm:col-span-2">
                  <legend>Criativos (salvos no Creative Studio)</legend>
                  {criativos.slice(0, 12).map((c) => (
                    <label key={c.id} className="flex items-center gap-2">
                      <input type="checkbox" name="criativoIds" value={c.id} />
                      <span className="text-zinc-300">{c.titulo}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <label className={rotulo + " sm:col-span-2"}>Por que esta campanha (opcional)
                <textarea name="justificativa" maxLength={2000} rows={2} className={campo} />
              </label>
              <div className="sm:col-span-2"><BotaoEnviar className={botao} aguarde="Conferindo...">Salvar rascunho</BotaoEnviar></div>
            </form>
          </details>
        </section>
      )}

      {!semTabela && (
        <section className="space-y-3">
          <h2 className="font-serif text-xl">Rascunhos e campanhas criadas</h2>
          {rascunhos.map((r) => {
            const publico = (r.publico ?? {}) as Partial<Publico>;
            const avisos = (r.avisos ?? []) as string[];
            const ids = (r.criativo_ids ?? []) as string[];
            return (
              <article key={r.id} className={cartao + " space-y-2 text-sm"}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-medium text-zinc-100">{r.nome}</p>
                  <span className={"text-xs " + (COR_STATUS[r.status as string] ?? "")}>
                    {ROTULO_STATUS[r.status as string] ?? r.status}{r.simulada ? " · SIMULADA" : ""}
                  </span>
                </div>
                <p className="text-zinc-400">
                  {NOME_PLATAFORMA[r.plataforma as Plataforma] ?? r.plataforma} · {ROTULO_OBJETIVO[r.objetivo as Objetivo] ?? r.objetivo} · {brl(Number(r.orcamento_diario))}/dia
                  · {r.origem === "diretor" ? "montado pelo Diretor" : "montado à mão"} em {quando(r.criado_em as string)}
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
                {r.resultado && <p className="text-xs text-zinc-500">{r.resultado}{r.campanha_externa_id ? ` (ID: ${r.campanha_externa_id})` : ""}</p>}

                {dono && r.status === "aguardando_aprovacao" && (
                  <div className="flex gap-2 pt-1">
                    <form action={decidirRascunho}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="rascunhoId" value={r.id} />
                      <input type="hidden" name="decisao" value="aprovar" />
                      <BotaoEnviar className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-zinc-950" aguarde="Criando...">
                        {real ? "Aprovar e criar pausada" : "Aprovar (simulado)"}
                      </BotaoEnviar>
                    </form>
                    <form action={decidirRascunho}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="rascunhoId" value={r.id} />
                      <input type="hidden" name="decisao" value="recusar" />
                      <BotaoEnviar className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300" aguarde="Salvando...">Recusar</BotaoEnviar>
                    </form>
                  </div>
                )}
                {dono && r.status === "publicada_pausada" && (
                  <form action={decidirRascunho} className="pt-1">
                    <input type="hidden" name="workspaceId" value={workspace.id} />
                    <input type="hidden" name="rascunhoId" value={r.id} />
                    <input type="hidden" name="decisao" value="ativar" />
                    <BotaoEnviar className="rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-medium text-zinc-950" aguarde="Ativando...">
                      {r.simulada ? "Aprovar ativação (simulado)" : "Aprovar ativação (começa a gastar)"}
                    </BotaoEnviar>
                  </form>
                )}
                {!dono && (r.status === "aguardando_aprovacao" || r.status === "publicada_pausada") && (
                  <p className="text-xs text-zinc-500">Aguardando o dono do workspace.</p>
                )}
              </article>
            );
          })}
          {!rascunhos.length && <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">Nenhum rascunho ainda.</p>}
        </section>
      )}

      <p className="text-xs text-zinc-500">
        Nesta versão a JUDITE cria a campanha com nome, objetivo e orçamento, pausada. O conjunto de anúncios (público) e os anúncios
        (criativos) são finalizados na plataforma, seguindo o rascunho. Google Ads ainda não tem criação por aqui.
      </p>
    </main>
  );
}
