/**
 * Presença no Google: Perfil da Empresa (avaliações, informações, desempenho) e Search Console
 * (consultas, cliques, posição). Leitura ao vivo pelas APIs oficiais. Responder avaliação e
 * publicar post passam por um rascunho que só o dono aprova; nada é publicado sozinho.
 */

import Link from "next/link";
import { BotaoEnviar } from "@/components/BotaoEnviar";
import { listarLocais, listarSitesGsc, type LinhaBusca, type LocalPerfil } from "@/lib/presenca/google";
import { lacunasDoPerfil, lerPresenca, type Parte } from "@/lib/presenca/painel";
import { fonteDaPlataforma } from "@/lib/windsor/conexao";
import { createAdminClient } from "@/lib/supabase/admin";
import { podeAgir } from "@/lib/trafego/acesso";
import { inteiro, percent } from "@/lib/trafego/metricas";
import { carregarWorkspace } from "../carregar";
import { decidirAcao, proporAcao, salvarEscolha } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ERROS: Record<string, string> = {
  "so-dono": "Só o dono do workspace pode configurar a presença e aprovar publicações.",
  papel: "Só o dono ou um admin pode escrever rascunhos.",
  escolha: "Escolha inválida: o perfil ou o site precisa ser um dos que a conta autorizada administra.",
  conexao: "A conexão com o Google não está pronta. Autorize de novo em Conexões.",
  google: "O Google recusou a consulta. Veja os avisos abaixo.",
  salvar: "Não foi possível salvar. Se a migração da Etapa 7 ainda não foi aplicada no Supabase, aplique-a primeiro.",
  rascunho: "Não foi possível salvar o rascunho. Confira o texto (até 1.500 caracteres).",
  decisao: "Essa ação já foi decidida ou não existe mais.",
  publicar: "O Google recusou a publicação. O motivo está no histórico abaixo.",
};
const AVISOS: Record<string, string> = {
  escolha: "Configuração salva.",
  rascunho: "Rascunho salvo. Ele só vai para o Google depois que o dono aprovar.",
  recusada: "Rascunho recusado. Nada foi publicado.",
  publicada: "Publicado no Google.",
};
const ROTULO_STATUS: Record<string, string> = {
  aguardando_aprovacao: "aguardando aprovação do dono", publicada: "publicada", recusada: "recusada", erro: "erro ao publicar",
};
const COR_STATUS: Record<string, string> = {
  aguardando_aprovacao: "text-amber-300", publicada: "text-emerald-300", recusada: "text-zinc-400", erro: "text-rose-300",
};

const campo = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";
const cartao = "rounded-xl border border-zinc-800 bg-zinc-900/60 p-4";
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function Falha({ motivo }: { motivo: string }) {
  return <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">Não foi possível ler do Google: {motivo}</p>;
}

function TabelaBusca({ titulo, coluna, parte }: { titulo: string; coluna: string; parte: Parte<LinhaBusca[]> | null }) {
  if (!parte) return null;
  return (
    <div className={cartao}>
      <h3 className="mb-3 font-serif text-lg">{titulo}</h3>
      {!parte.ok ? <Falha motivo={parte.motivo} /> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1 pr-2 font-medium">{coluna}</th>
              <th className="py-1 pr-2 text-right font-medium">Cliques</th>
              <th className="py-1 pr-2 text-right font-medium">Impressões</th>
              <th className="py-1 pr-2 text-right font-medium">CTR</th>
              <th className="py-1 text-right font-medium">Posição</th>
            </tr>
          </thead>
          <tbody>
            {parte.dados.map((l) => (
              <tr key={l.chave} className="border-t border-zinc-800">
                <td className="max-w-[260px] truncate py-1.5 pr-2 text-zinc-300" title={l.chave}>{l.chave}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-400">{inteiro(l.cliques)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{inteiro(l.impressoes)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{percent(l.ctr)}</td>
                <td className="py-1.5 text-right tabular-nums text-zinc-400">{l.posicao.toFixed(1).replace(".", ",")}</td>
              </tr>
            ))}
            {!parte.dados.length && <tr><td colSpan={5} className="py-4 text-center text-zinc-500">Sem dados no período.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function PresencaPage(props: PageProps<"/painel/[workspaceId]/presenca">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const dono = papel === "owner";
  const gestor = podeAgir(papel);
  const params = await props.searchParams;
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;
  const aviso = typeof params.aviso === "string" ? AVISOS[params.aviso] : undefined;

  const { data: conexoes } = await supabase.from("conexoes").select("provedor, dados, conectado_em")
    .eq("workspace_id", workspace.id).in("provedor", ["google_presenca", "windsor"]);
  const conexao = conexoes?.find((c) => c.provedor === "google_presenca");
  const windsor = conexoes?.find((c) => c.provedor === "windsor");
  // O dono pode escolher ler a Presença pela Windsor (só leitura); publicar continua pela conexão própria.
  const pelaWindsor = Boolean(windsor?.conectado_em) && fonteDaPlataforma(windsor?.dados, "presenca") === "windsor";
  const autorizadaNoGoogle = Boolean((conexao?.dados as { tem_autorizacao?: boolean } | undefined)?.tem_autorizacao);
  const autorizada = autorizadaNoGoogle || pelaWindsor;

  const cabecalho = (
    <header>
      <h1 className="font-serif text-3xl">Presença no Google</h1>
      <p className="text-sm text-zinc-500">Perfil da Empresa no Google (antigo Google Meu Negócio) e resultados da busca (Search Console).</p>
    </header>
  );
  const alertaApi = pelaWindsor ? (
    <p className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm text-sky-100">
      <strong>Dados pela Windsor.ai</strong> (só leitura). Responder avaliações e publicar posts continua pela conexão própria do Google,
      {" "}sempre depois da aprovação do dono{autorizadaNoGoogle ? "." : ": para publicar por aqui, conecte também o Google em "}
      {!autorizadaNoGoogle && <Link href={`/painel/${workspace.id}/conexoes`} className="underline">Conexões</Link>}
      {!autorizadaNoGoogle && "."} A primeira leitura pela Windsor pode demorar alguns minutos.
    </p>
  ) : (
    <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
      <strong>Importante:</strong> o Google só libera a Business Profile API (avaliações, informações e posts do perfil) depois de um
      {" "}<strong>pedido de acesso</strong> para o projeto do Google Cloud, e a análise pode levar dias ou semanas. Enquanto isso, a parte
      do perfil mostra um aviso e o Search Console funciona normalmente. O passo a passo está em{" "}
      <Link href={`/painel/${workspace.id}/conexoes`} className="underline">Conexões</Link>.
    </p>
  );

  if (!autorizada) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6">
        {cabecalho}
        {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}</p>}
        {alertaApi}
        <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-300">
          Ainda não há autorização do Google para esta área. {dono
            ? <>Abra <Link href={`/painel/${workspace.id}/conexoes`} className="text-amber-300 underline">Conexões</Link> e, na seção &quot;Presença no Google&quot;, clique em Autorizar.</>
            : "Peça ao dono do workspace para autorizar em Conexões."}
        </p>
      </main>
    );
  }

  // A leitura usa os tokens do workspace: só depois de carregarWorkspace() confirmar que quem pede é membro.
  const db = createAdminClient();
  const lido = await lerPresenca(db, workspace.id);
  const { data: acoes, error: erroTabela } = await supabase.from("presenca_acoes")
    .select("id, criado_em, tipo, contexto, conteudo, status, resultado").eq("workspace_id", workspace.id)
    .order("criado_em", { ascending: false }).limit(20);

  // Opções para o dono escolher o perfil e a propriedade (só carrega para o dono).
  let locais: LocalPerfil[] = [];
  let sitesGsc: string[] = [];
  let falhaLocais: string | null = null;
  let falhaSites: string | null = null;
  if (dono && lido.ok && lido.presenca.fonte === "google") {
    try { locais = await listarLocais(lido.presenca.acesso.token); } catch (e) { falhaLocais = e instanceof Error ? e.message : "falha"; }
    try { sitesGsc = await listarSitesGsc(lido.presenca.acesso.token); } catch (e) { falhaSites = e instanceof Error ? e.message : "falha"; }
  }

  const p = lido.ok ? lido.presenca : null;
  const perfil = p?.perfil?.ok ? p.perfil.dados : null;
  const total = p?.buscaTotal?.ok ? p.buscaTotal.dados[0] : null;
  const pendentes = (acoes ?? []).filter((a) => a.status === "aguardando_aprovacao");

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
      {cabecalho}
      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</p>}
      {alertaApi}
      {!lido.ok && <Falha motivo={lido.motivo} />}
      {erroTabela && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          A fila de aprovações ainda não existe no banco. Aplique a migração da Etapa 7 no Supabase (veja docs/PENDENTE.md).
        </p>
      )}

      {dono && p?.fonte === "windsor" && (
        <p className={cartao + " text-sm text-zinc-400"}>
          O perfil e o site lidos pela Windsor são escolhidos em{" "}
          <Link href={`/painel/${workspace.id}/conexoes`} className="text-amber-300 underline">Conexões</Link>, na seção Windsor.ai.
        </p>
      )}
      {dono && lido.ok && p?.fonte === "google" && (
        <details className={cartao} open={!p?.acesso.local && !p?.acesso.siteGsc}>
          <summary className="cursor-pointer text-sm font-medium">Configuração: qual perfil e qual site são deste workspace</summary>
          <form action={salvarEscolha} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <label className="space-y-1 text-xs text-zinc-400">Perfil da Empresa
              <select name="perfil" defaultValue={p?.acesso.conta && p.acesso.local ? `${p.acesso.conta}|${p.acesso.local}` : ""} className={campo}>
                <option value="">Não usar o perfil</option>
                {locais.map((l) => <option key={l.local} value={`${l.conta}|${l.local}`}>{l.titulo}{l.endereco ? ` — ${l.endereco}` : ""}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs text-zinc-400">Propriedade do Search Console
              <select name="siteGsc" defaultValue={p?.acesso.siteGsc ?? ""} className={campo}>
                <option value="">Não usar o Search Console</option>
                {sitesGsc.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <BotaoEnviar className={botao} aguarde="Conferindo...">Salvar</BotaoEnviar>
          </form>
          {falhaLocais && <p className="mt-2 text-xs text-amber-200">Perfis: {falhaLocais}</p>}
          {falhaSites && <p className="mt-2 text-xs text-amber-200">Search Console: {falhaSites}</p>}
          {!falhaSites && !sitesGsc.length && (
            <p className="mt-2 text-xs text-zinc-500">
              Nenhuma propriedade encontrada. Cadastre e verifique o site em search.google.com/search-console com o mesmo e-mail que autorizou.
            </p>
          )}
        </details>
      )}

      {/* ---------------------------------------------------------------- Perfil da Empresa */}
      {p?.perfil && (
        <section className="space-y-3">
          <h2 className="font-serif text-xl">Perfil da Empresa</h2>
          {!p.perfil.ok ? <Falha motivo={p.perfil.motivo} /> : perfil && (
            <div className={cartao + " space-y-2 text-sm"}>
              <p className="text-lg text-zinc-100">{perfil.titulo}</p>
              <p className="text-zinc-400">{[perfil.categoria, perfil.endereco].filter(Boolean).join(" · ")}</p>
              <p className="text-zinc-400">{[perfil.telefone, perfil.site].filter(Boolean).join(" · ")}</p>
              {lacunasDoPerfil(perfil).length > 0 && (
                <p className="text-amber-200">Falta preencher no perfil: {lacunasDoPerfil(perfil).join(", ")}.</p>
              )}
            </div>
          )}

          {p.desempenho && (!p.desempenho.ok ? <Falha motivo={p.desempenho.motivo} /> : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { rotulo: "Visualizações do perfil", valor: p.desempenho.dados.visualizacoes },
                { rotulo: "Cliques para o site", valor: p.desempenho.dados.cliquesNoSite },
                { rotulo: "Ligações", valor: p.desempenho.dados.ligacoes },
                { rotulo: "Pedidos de rota", valor: p.desempenho.dados.rotas },
              ].map((c) => (
                <div key={c.rotulo} className={cartao}>
                  <p className="text-xs text-zinc-500">{c.rotulo} ({p.periodo.dias} dias)</p>
                  <p className="mt-1 text-2xl tabular-nums text-zinc-100">{inteiro(c.valor)}</p>
                </div>
              ))}
            </div>
          ))}

          {p.avaliacoes && (!p.avaliacoes.ok ? <Falha motivo={p.avaliacoes.motivo} /> : (
            <div className={cartao + " space-y-3"}>
              <h3 className="font-serif text-lg">
                Avaliações
                <span className="ml-2 text-sm text-zinc-400">
                  {p.avaliacoes.dados.media !== null ? `nota ${p.avaliacoes.dados.media.toFixed(1).replace(".", ",")}` : "sem nota"}
                  {p.avaliacoes.dados.total !== null ? ` · ${inteiro(p.avaliacoes.dados.total)} no total` : ""}
                </span>
              </h3>
              {p.avaliacoes.dados.lista.map((a) => (
                <div key={a.nome} className="space-y-2 border-t border-zinc-800 pt-3 text-sm">
                  <p className="text-zinc-300">
                    <span className="text-amber-300">{a.estrelas ? "★".repeat(a.estrelas) + "☆".repeat(5 - a.estrelas) : "sem nota"}</span>
                    <span className="ml-2">{a.autor}</span>
                    {a.criadaEm && <span className="ml-2 text-xs text-zinc-500">{dataBr(a.criadaEm)}</span>}
                  </p>
                  {a.comentario && <p className="text-zinc-400">{a.comentario}</p>}
                  {a.resposta ? (
                    <p className="rounded-lg bg-zinc-950 p-2 text-zinc-400"><span className="text-zinc-500">Sua resposta: </span>{a.resposta}</p>
                  ) : gestor && !erroTabela && p.fonte === "google" && (
                    <details>
                      <summary className="cursor-pointer text-xs text-amber-300">Escrever resposta (vai para aprovação)</summary>
                      <form action={proporAcao} className="mt-2 space-y-2">
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="tipo" value="responder_avaliacao" />
                        <input type="hidden" name="alvo" value={a.nome} />
                        <input type="hidden" name="contexto" value={`${a.estrelas ?? "?"} estrela(s): ${(a.comentario ?? "(sem comentário)").slice(0, 900)}`} />
                        <textarea name="conteudo" required maxLength={1500} rows={3} className={campo} placeholder="Escreva a resposta com as suas palavras" />
                        <BotaoEnviar className={botao} aguarde="Salvando...">Salvar rascunho</BotaoEnviar>
                      </form>
                    </details>
                  )}
                </div>
              ))}
              {!p.avaliacoes.dados.lista.length && <p className="text-sm text-zinc-500">Nenhuma avaliação encontrada.</p>}
            </div>
          ))}

          {gestor && !erroTabela && perfil && (
            <details className={cartao}>
              <summary className="cursor-pointer text-sm font-medium">Escrever um post para o perfil (vai para aprovação)</summary>
              <form action={proporAcao} className="mt-3 space-y-2">
                <input type="hidden" name="workspaceId" value={workspace.id} />
                <input type="hidden" name="tipo" value="publicar_post" />
                <input type="hidden" name="alvo" value="" />
                <input type="hidden" name="contexto" value="" />
                <textarea name="conteudo" required maxLength={1500} rows={4} className={campo} placeholder="Texto do post (novidade). Não invente preços nem promessas." />
                <BotaoEnviar className={botao} aguarde="Salvando...">Salvar rascunho</BotaoEnviar>
              </form>
            </details>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- Aprovações */}
      {!erroTabela && (
        <section className="space-y-3">
          <h2 className="font-serif text-xl">Aprovações {pendentes.length > 0 && <span className="text-sm text-amber-300">({pendentes.length} aguardando)</span>}</h2>
          <p className="text-xs text-zinc-500">Nada é publicado no Google sem o dono clicar em Aprovar e publicar.</p>
          {(acoes ?? []).map((a) => (
            <article key={a.id} className={cartao + " space-y-2 text-sm"}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-zinc-400">{a.tipo === "publicar_post" ? "Post no perfil" : "Resposta a avaliação"} · {dataBr(a.criado_em as string)}</span>
                <span className={COR_STATUS[a.status as string] ?? ""}>{ROTULO_STATUS[a.status as string] ?? a.status}</span>
              </div>
              {a.contexto && <p className="text-xs text-zinc-500">Avaliação: {a.contexto}</p>}
              <p className="whitespace-pre-wrap text-zinc-200">{a.conteudo}</p>
              {a.resultado && <p className="text-xs text-zinc-500">{a.resultado}</p>}
              {dono && a.status === "aguardando_aprovacao" && (
                <div className="flex gap-2">
                  <form action={decidirAcao}>
                    <input type="hidden" name="workspaceId" value={workspace.id} />
                    <input type="hidden" name="acaoId" value={a.id} />
                    <input type="hidden" name="decisao" value="aprovar" />
                    <BotaoEnviar className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-zinc-950" aguarde="Publicando...">Aprovar e publicar</BotaoEnviar>
                  </form>
                  <form action={decidirAcao}>
                    <input type="hidden" name="workspaceId" value={workspace.id} />
                    <input type="hidden" name="acaoId" value={a.id} />
                    <input type="hidden" name="decisao" value="recusar" />
                    <BotaoEnviar className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300" aguarde="Salvando...">Recusar</BotaoEnviar>
                  </form>
                </div>
              )}
            </article>
          ))}
          {!(acoes ?? []).length && <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">Nenhum rascunho ainda.</p>}
        </section>
      )}

      {/* ---------------------------------------------------------------- Search Console */}
      {p?.acesso.siteGsc && (
        <section className="space-y-3">
          <h2 className="font-serif text-xl">Busca do Google <span className="text-sm text-zinc-500">{p.acesso.siteGsc} · {dataBr(p.periodo.de)} a {dataBr(p.periodo.ate)}</span></h2>
          {p.buscaTotal && !p.buscaTotal.ok && <Falha motivo={p.buscaTotal.motivo} />}
          {total && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { rotulo: "Cliques", valor: inteiro(total.cliques) },
                { rotulo: "Impressões", valor: inteiro(total.impressoes) },
                { rotulo: "CTR (cliques ÷ impressões)", valor: percent(total.ctr) },
                { rotulo: "Posição média", valor: total.posicao.toFixed(1).replace(".", ",") },
              ].map((c) => (
                <div key={c.rotulo} className={cartao}>
                  <p className="text-xs text-zinc-500">{c.rotulo}</p>
                  <p className="mt-1 text-2xl tabular-nums text-zinc-100">{c.valor}</p>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <TabelaBusca titulo="O que as pessoas pesquisaram" coluna="Consulta" parte={p.consultas} />
            <TabelaBusca titulo="Páginas que apareceram" coluna="Página" parte={p.paginas} />
          </div>
        </section>
      )}

      <p className="text-xs text-zinc-500">
        O <Link href={`/painel/${workspace.id}/diretor`} className="underline">Diretor</Link> usa estes dados para sugerir melhorias no perfil e no site (SEO/AEO).
      </p>
    </main>
  );
}
