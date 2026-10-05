/**
 * Creative Studio e Learning Engine: produtos cadastrados (a fonte dos fatos), variações de texto
 * geradas pela IA, testes A/B registrados e a memória do que funcionou, consultada pelo Diretor.
 */

import { BotaoEnviar } from "@/components/BotaoEnviar";
import { iaConfigurada, PROVEDORES_IA, provedorParaConfigurar } from "@/lib/ia";
import { podeAgir } from "@/lib/trafego/acesso";
import { brl } from "@/lib/trafego/metricas";
import { hojeEmBrasilia } from "@/lib/trafego/mes";
import { NOME_PLATAFORMA, PLATAFORMAS, type Plataforma } from "@/lib/trafego/tipos";
import { carregarWorkspace } from "../carregar";
import {
  adicionarAprendizado, concluirExperimento, criarExperimento, gerar, mudarStatusCriativo, removerProduto, salvarProduto,
} from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ERROS: Record<string, string> = {
  papel: "Só o dono ou um admin do workspace pode usar o Creative Studio.",
  produto: "Confira os dados do produto (o nome é obrigatório; preço só com números).",
  salvar: "Não foi possível salvar. Talvez já exista um produto com esse nome.",
  "sem-chave": "Falta a chave da IA ({variavel}). Veja a explicação na página Diretor.",
  "geracao-dados": "Escolha um produto para gerar as variações.",
  recente: "Acabou de sair uma geração. Aguarde alguns segundos antes de pedir outra.",
  ia: "A IA não conseguiu gerar as variações.",
  experimento: "Confira os dados do experimento (nome, métrica e data de início).",
  conclusao: "Não foi possível concluir. Escreva a conclusão e escolha o vencedor.",
  aprendizado: "Escreva o aprendizado (até 1.000 caracteres).",
};
const AVISOS: Record<string, string> = {
  produto: "Produto cadastrado.",
  "produto-removido": "Produto desativado.",
  criativo: "Criativo atualizado.",
  experimento: "Experimento registrado.",
  concluido: "Experimento concluído. A conclusão foi guardada nos aprendizados.",
  aprendizado: "Aprendizado guardado.",
};
const METRICAS: Record<string, string> = {
  ctr: "CTR (cliques ÷ impressões)", cpc: "Custo por clique", conversoes: "Conversões", whatsapp: "Cliques no WhatsApp", vendas: "Vendas",
};
const CATEGORIAS: Record<string, string> = {
  criativo: "Criativo", publico: "Público", oferta: "Oferta", canal: "Canal", site: "Site", outro: "Outro",
};
const STATUS_HIPOTESE: Record<string, string> = { aberta: "em teste", confirmada: "confirmada", refutada: "refutada", inconclusiva: "inconclusiva" };

const campo = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";
const cartao = "rounded-xl border border-zinc-800 bg-zinc-900/60 p-4";
const rotulo = "space-y-1 text-xs text-zinc-400";
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export default async function CriativosPage(props: PageProps<"/painel/[workspaceId]/criativos">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const gestor = podeAgir(papel);
  const params = await props.searchParams;
  const motivo = typeof params.motivo === "string" ? params.motivo.slice(0, 200) : "";
  const variavelIA = PROVEDORES_IA[provedorParaConfigurar()].variavel;
  const erro = typeof params.erro === "string" ? ERROS[params.erro]?.replace("{variavel}", variavelIA) : undefined;
  const aviso = typeof params.aviso === "string"
    ? params.aviso === "geradas"
      ? `${Number(params.salvas) || 0} variação(ões) salva(s) como rascunho.` +
        (Number(params.barradas) ? ` ${Number(params.barradas)} foi(ram) barrada(s) na conferência (número fora do cadastro ou tamanho acima do limite).` : "")
      : AVISOS[params.aviso]
    : undefined;
  const temChave = iaConfigurada();

  const [produtosR, criativosR, experimentosR, hipotesesR, aprendizadosR] = await Promise.all([
    supabase.from("produtos").select("id, nome, descricao, preco, detalhes, publico, ativo").eq("workspace_id", workspace.id).eq("ativo", true).order("nome"),
    supabase.from("criativos").select("id, produto_id, criado_em, origem, formato, plataforma, titulo, descricao, cta, texto, status")
      .eq("workspace_id", workspace.id).neq("status", "arquivado").order("criado_em", { ascending: false }).limit(60),
    supabase.from("experimentos").select("*").eq("workspace_id", workspace.id).order("criado_em", { ascending: false }).limit(50),
    supabase.from("hipoteses").select("id, texto, status").eq("workspace_id", workspace.id).limit(200),
    supabase.from("aprendizados").select("id, categoria, texto, criado_em").eq("workspace_id", workspace.id).order("criado_em", { ascending: false }).limit(50),
  ]);
  const semTabelas = Boolean(produtosR.error);
  const produtos = produtosR.data ?? [];
  const criativos = criativosR.data ?? [];
  const experimentos = experimentosR.data ?? [];
  const hipoteses = hipotesesR.data ?? [];
  const aprendizados = aprendizadosR.data ?? [];
  const nomeProduto = (id: string | null) => produtos.find((p) => p.id === id)?.nome ?? "";
  const tituloCriativo = (id: string | null) => criativos.find((c) => c.id === id)?.titulo ?? (id ? "(arquivado)" : "-");

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
      <header>
        <h1 className="font-serif text-3xl">Creative Studio</h1>
        <p className="text-sm text-zinc-500">
          Textos de anúncio escritos pela IA a partir dos produtos cadastrados, testes A/B e o que a JUDITE aprendeu com eles.
        </p>
      </header>

      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}{motivo ? ` ${motivo}` : ""}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</p>}
      {semTabelas && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          As tabelas do Creative Studio ainda não existem no banco. Aplique a migração da Etapa 8 no Supabase (veja docs/PENDENTE.md) e recarregue.
        </p>
      )}

      {!semTabelas && (
        <>
          {/* ------------------------------------------------------------ Produtos */}
          <section className="space-y-3">
            <h2 className="font-serif text-xl">Produtos</h2>
            <p className="text-xs text-zinc-500">
              A IA só usa o que estiver cadastrado aqui. Preço, duração e o que inclui só entram no anúncio se você escrever; o que não estiver aqui não é inventado.
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              {produtos.map((p) => (
                <div key={p.id} className={cartao + " space-y-1 text-sm"}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-zinc-100">{p.nome}</p>
                    <span className="shrink-0 tabular-nums text-zinc-300">{p.preco === null ? "sem preço" : brl(Number(p.preco))}</span>
                  </div>
                  {p.descricao && <p className="text-zinc-400">{p.descricao}</p>}
                  {p.detalhes && <p className="text-zinc-500">{p.detalhes}</p>}
                  {p.publico && <p className="text-xs text-zinc-500">Público: {p.publico}</p>}
                  {gestor && (
                    <form action={removerProduto}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="produtoId" value={p.id} />
                      <button className="text-xs text-zinc-500 hover:text-rose-400">desativar</button>
                    </form>
                  )}
                </div>
              ))}
              {!produtos.length && <p className="text-sm text-zinc-500">Nenhum produto cadastrado ainda.</p>}
            </div>
            {gestor && (
              <details className={cartao} open={!produtos.length}>
                <summary className="cursor-pointer text-sm font-medium">Cadastrar produto</summary>
                <form action={salvarProduto} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <label className={rotulo}>Nome
                    <input name="nome" required maxLength={120} className={campo} />
                  </label>
                  <label className={rotulo}>Preço em R$ (deixe vazio se não quiser citar)
                    <input name="preco" type="number" min={0} step="0.01" className={campo} />
                  </label>
                  <label className={rotulo + " sm:col-span-2"}>Descrição
                    <textarea name="descricao" maxLength={2000} rows={2} className={campo} />
                  </label>
                  <label className={rotulo + " sm:col-span-2"}>Fatos importantes (duração, o que inclui, saída, diferenciais). Só o que for verdade.
                    <textarea name="detalhes" maxLength={2000} rows={2} className={campo} />
                  </label>
                  <label className={rotulo}>Para quem é
                    <input name="publico" maxLength={500} className={campo} />
                  </label>
                  <label className={rotulo}>Link da página (opcional)
                    <input name="link" maxLength={300} className={campo} />
                  </label>
                  <div className="sm:col-span-2"><BotaoEnviar className={botao} aguarde="Salvando...">Cadastrar produto</BotaoEnviar></div>
                </form>
              </details>
            )}
          </section>

          {/* ------------------------------------------------------------ Gerar */}
          {gestor && (
            <section className={cartao + " space-y-3"}>
              <h2 className="font-serif text-xl">Pedir variações de anúncio</h2>
              {!temChave && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  Falta a chave da IA (<code className="font-mono text-xs">{variavelIA}</code>). O passo a passo está na página Diretor.
                </p>
              )}
              <form action={gerar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <input type="hidden" name="workspaceId" value={workspace.id} />
                <label className={rotulo}>Produto
                  <select name="produtoId" required className={campo} defaultValue="">
                    <option value="" disabled>Escolha</option>
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </label>
                <label className={rotulo}>Plataforma
                  <select name="plataforma" className={campo} defaultValue="facebook">
                    {PLATAFORMAS.map((p) => <option key={p} value={p}>{NOME_PLATAFORMA[p]}</option>)}
                  </select>
                </label>
                <label className={rotulo}>Quantas variações
                  <select name="quantidade" className={campo} defaultValue="4">
                    {[2, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className={rotulo}>Orientação (opcional)
                  <input name="orientacao" maxLength={300} placeholder="Ex.: foco em famílias" className={campo} />
                </label>
                <div className="sm:col-span-2 lg:col-span-4">
                  <BotaoEnviar className={botao} aguarde="Escrevendo... (pode levar 1 minuto)">Gerar variações (AIDA e PAS)</BotaoEnviar>
                </div>
              </form>
            </section>
          )}

          {/* ------------------------------------------------------------ Criativos */}
          <section className="space-y-3">
            <h2 className="font-serif text-xl">Criativos</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {criativos.map((c) => (
                <article key={c.id} className={cartao + " space-y-2 text-sm"}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>{c.formato} · {c.plataforma ? NOME_PLATAFORMA[c.plataforma as Plataforma] : "sem plataforma"} · {nomeProduto(c.produto_id as string | null)}</span>
                    <span className={c.status === "aprovado" ? "text-emerald-300" : "text-amber-300"}>{c.status === "aprovado" ? "salvo" : "rascunho"}</span>
                  </div>
                  <p className="font-medium text-zinc-100">{c.titulo}</p>
                  {c.descricao && <p className="text-zinc-300">{c.descricao}</p>}
                  {c.texto && <p className="whitespace-pre-wrap text-zinc-400">{c.texto}</p>}
                  {c.cta && <p className="text-xs text-amber-300">Chamada: {c.cta}</p>}
                  {gestor && (
                    <div className="flex gap-3 text-xs">
                      {c.status !== "aprovado" && (
                        <form action={mudarStatusCriativo}>
                          <input type="hidden" name="workspaceId" value={workspace.id} />
                          <input type="hidden" name="criativoId" value={c.id} />
                          <input type="hidden" name="status" value="aprovado" />
                          <button className="text-emerald-300 hover:underline">salvar</button>
                        </form>
                      )}
                      <form action={mudarStatusCriativo}>
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="criativoId" value={c.id} />
                        <input type="hidden" name="status" value="arquivado" />
                        <button className="text-zinc-500 hover:text-rose-400">descartar</button>
                      </form>
                    </div>
                  )}
                </article>
              ))}
            </div>
            {!criativos.length && <p className="text-sm text-zinc-500">Nenhum criativo ainda. Cadastre um produto e peça variações.</p>}
          </section>

          {/* ------------------------------------------------------------ Experimentos */}
          <section className="space-y-3">
            <h2 className="font-serif text-xl">Experimentos (testes A/B)</h2>
            <p className="text-xs text-zinc-500">
              Registre o que está sendo testado. Ao terminar, digite os números reais da plataforma; a conclusão vira um aprendizado.
            </p>
            {gestor && (
              <details className={cartao}>
                <summary className="cursor-pointer text-sm font-medium">Registrar novo experimento</summary>
                <form action={criarExperimento} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <label className={rotulo}>Nome do teste
                    <input name="nome" required maxLength={160} className={campo} />
                  </label>
                  <label className={rotulo + " lg:col-span-2"}>Hipótese (o que você acha que vai acontecer)
                    <input name="hipotese" maxLength={500} className={campo} />
                  </label>
                  <label className={rotulo}>Produto
                    <select name="produtoId" className={campo} defaultValue="">
                      <option value="">Nenhum</option>
                      {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                  </label>
                  <label className={rotulo}>Criativo A
                    <select name="criativoA" className={campo} defaultValue="">
                      <option value="">Não informado</option>
                      {criativos.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
                    </select>
                  </label>
                  <label className={rotulo}>Criativo B
                    <select name="criativoB" className={campo} defaultValue="">
                      <option value="">Não informado</option>
                      {criativos.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
                    </select>
                  </label>
                  <label className={rotulo}>Plataforma
                    <select name="plataforma" className={campo} defaultValue="">
                      <option value="">Não informada</option>
                      {PLATAFORMAS.map((p) => <option key={p} value={p}>{NOME_PLATAFORMA[p]}</option>)}
                    </select>
                  </label>
                  <label className={rotulo}>Métrica que decide
                    <select name="metrica" className={campo} defaultValue="ctr">
                      {Object.entries(METRICAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label className={rotulo}>Início
                    <input name="inicio" type="date" required defaultValue={hojeEmBrasilia()} className={campo} />
                  </label>
                  <div className="sm:col-span-2 lg:col-span-3"><BotaoEnviar className={botao} aguarde="Salvando...">Registrar experimento</BotaoEnviar></div>
                </form>
              </details>
            )}
            {experimentos.map((e) => {
              const hipotese = hipoteses.find((h) => h.id === e.hipotese_id);
              return (
                <article key={e.id} className={cartao + " space-y-2 text-sm"}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-zinc-100">{e.nome}</p>
                    <span className={"text-xs " + (e.status === "concluido" ? "text-emerald-300" : "text-amber-300")}>
                      {e.status === "concluido" ? "concluído" : "rodando"} · {dataBr(e.inicio as string)}{e.fim ? ` a ${dataBr(e.fim as string)}` : ""}
                    </span>
                  </div>
                  {hipotese && <p className="text-zinc-400">Hipótese: {hipotese.texto} <span className="text-xs text-zinc-500">({STATUS_HIPOTESE[hipotese.status as string] ?? hipotese.status})</span></p>}
                  <p className="text-xs text-zinc-500">
                    A: {tituloCriativo(e.criativo_a as string | null)} · B: {tituloCriativo(e.criativo_b as string | null)} · decide por {METRICAS[e.metrica as string] ?? e.metrica}
                  </p>
                  {e.status === "concluido" && (
                    <p className="text-zinc-300">
                      Resultado: A = {e.resultado_a ?? "-"} · B = {e.resultado_b ?? "-"} · vencedor: {e.vencedor === "empate" ? "empate" : String(e.vencedor ?? "-").toUpperCase()}.
                      {e.conclusao ? ` ${e.conclusao}` : ""}
                    </p>
                  )}
                  {gestor && e.status === "rodando" && (
                    <details>
                      <summary className="cursor-pointer text-xs text-amber-300">Concluir com os resultados</summary>
                      <form action={concluirExperimento} className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="experimentoId" value={e.id} />
                        <label className={rotulo}>Resultado A
                          <input name="resultadoA" type="number" step="any" min={0} className={campo} />
                        </label>
                        <label className={rotulo}>Resultado B
                          <input name="resultadoB" type="number" step="any" min={0} className={campo} />
                        </label>
                        <label className={rotulo}>Vencedor
                          <select name="vencedor" className={campo} defaultValue="empate">
                            <option value="a">A</option><option value="b">B</option><option value="empate">Empate / sem diferença clara</option>
                          </select>
                        </label>
                        <label className={rotulo}>A hipótese foi
                          <select name="hipotese" className={campo} defaultValue="inconclusiva">
                            <option value="confirmada">confirmada</option><option value="refutada">refutada</option><option value="inconclusiva">inconclusiva</option>
                          </select>
                        </label>
                        <label className={rotulo}>Tipo de aprendizado
                          <select name="categoria" className={campo} defaultValue="criativo">
                            {Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </label>
                        <label className={rotulo + " sm:col-span-2 lg:col-span-5"}>O que aprendemos (vai para a memória do Diretor)
                          <textarea name="conclusao" required maxLength={1000} rows={2} className={campo} />
                        </label>
                        <div><BotaoEnviar className={botao} aguarde="Salvando...">Concluir</BotaoEnviar></div>
                      </form>
                    </details>
                  )}
                </article>
              );
            })}
            {!experimentos.length && <p className="text-sm text-zinc-500">Nenhum experimento registrado.</p>}
          </section>

          {/* ------------------------------------------------------------ Aprendizados */}
          <section className="space-y-3">
            <h2 className="font-serif text-xl">Aprendizados</h2>
            <ul className="space-y-2">
              {aprendizados.map((a) => (
                <li key={a.id} className={cartao + " text-sm"}>
                  <span className="mr-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{CATEGORIAS[a.categoria as string] ?? a.categoria}</span>
                  <span className="text-zinc-200">{a.texto}</span>
                  <span className="ml-2 text-xs text-zinc-500">{dataBr(a.criado_em as string)}</span>
                </li>
              ))}
            </ul>
            {!aprendizados.length && <p className="text-sm text-zinc-500">Nada aprendido ainda. Conclua um experimento ou anote algo que você já sabe.</p>}
            {gestor && (
              <form action={adicionarAprendizado} className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
                <input type="hidden" name="workspaceId" value={workspace.id} />
                <label className={rotulo}>Tipo
                  <select name="categoria" className={campo} defaultValue="criativo">
                    {Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className={rotulo}>Anotar um aprendizado
                  <input name="texto" required maxLength={1000} placeholder="Ex.: vídeo com depoimento gera mais cliques no WhatsApp que foto" className={campo} />
                </label>
                <BotaoEnviar className={botao} aguarde="Salvando...">Guardar</BotaoEnviar>
              </form>
            )}
          </section>
        </>
      )}
    </main>
  );
}
