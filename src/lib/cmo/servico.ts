/**
 * Liga o motor da CMO ao banco e à IA de verdade. SOMENTE no servidor, e só depois de conferir
 * quem pediu (sessão de dono/admin ou segredo do cron): usa o cliente com service role.
 *
 * A lógica fica em gerar.ts, ideias.ts e ciclo.ts (testadas sem rede); aqui só há leitura e escrita.
 */

import { randomUUID } from "node:crypto";
import { gravarRascunho } from "@/lib/campanhas/gravar";
import { carregarResumo } from "@/lib/diretor/resumo";
import { iaConfigurada, mensagemSemChave, pedirJson } from "@/lib/ia";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { SituacaoDoMes } from "@/lib/trafego/limites";
import { hojeEmBrasilia, lerLimites, situacaoDoMes } from "@/lib/trafego/mes";
import { campanhaAtiva, PLATAFORMAS, type Plataforma } from "@/lib/trafego/tipos";
import { planoIaSchema } from "./agentes";
import { cicloDiario, executarComRegistro, type Registro, type ResultadoDoCiclo } from "./ciclo";
import { ehEstado, mudarEstado, proximoEstadoMonitorado, RODANDO } from "./estados";
import { repositorioDeEstados } from "./estados-db";
import { gerarCampanha, type ContextoCMO, type Dependencias, type PedidoDeCampanha, type ResultadoDaGeracao } from "./gerar";
import { gerarIdeias, ideiasIaSchema, type DependenciasDeIdeias, type ResultadoDeIdeias } from "./ideias";
import { nivelEfetivo, type Nivel } from "./niveis";
import type { CampanhaExistente, ProdutoCMO } from "./oportunidades";

type Admin = ReturnType<typeof createAdminClient>;

/** COLETA: tudo o que a CMO precisa para decidir, lido do banco. */
export async function carregarContexto(db: Admin, workspaceId: string): Promise<ContextoCMO> {
  const [resumo, produtosR, criativosR, cfgR, aprendizadosR] = await Promise.all([
    carregarResumo(db, workspaceId),
    db.from("produtos").select("id, nome, descricao, preco, detalhes, publico, link").eq("workspace_id", workspaceId).eq("ativo", true).order("nome"),
    db.from("criativos").select("produto_id").eq("workspace_id", workspaceId).eq("status", "aprovado").limit(1000),
    db.from("trafego_config").select("chave, valor").eq("workspace_id", workspaceId),
    db.from("aprendizados").select("categoria, texto").eq("workspace_id", workspaceId).order("criado_em", { ascending: false }).limit(10),
  ]);
  if (produtosR.error) throw new Error("produtos");

  // A coluna "oportunidade" só existe depois da migração da CMO; sem ela, lê o essencial.
  let campanhasR = await db.from("campanha_rascunhos").select("produto_id, plataforma, status, origem, criado_em, oportunidade")
    .eq("workspace_id", workspaceId).order("criado_em", { ascending: false }).limit(300);
  if (campanhasR.error) {
    campanhasR = await db.from("campanha_rascunhos").select("produto_id, plataforma, status, origem, criado_em")
      .eq("workspace_id", workspaceId).order("criado_em", { ascending: false }).limit(300) as unknown as typeof campanhasR;
  }
  if (campanhasR.error) throw new Error("campanha_rascunhos");

  const limites = lerLimites(cfgR.data);
  const canais: Partial<Record<Plataforma, SituacaoDoMes>> = {};
  for (const p of PLATAFORMAS) {
    if (limites.mensalPorCanal[p] > 0) canais[p] = await situacaoDoMes(db, workspaceId, limites.mensalPorCanal[p], undefined, p);
  }
  const aprovados = new Map<string, number>();
  for (const c of criativosR.data ?? []) if (c.produto_id) aprovados.set(c.produto_id as string, (aprovados.get(c.produto_id as string) ?? 0) + 1);

  return {
    resumo,
    produtos: (produtosR.data ?? []).map((p): ProdutoCMO => ({
      id: p.id as string, nome: p.nome as string, descricao: (p.descricao as string | null) ?? null,
      preco: p.preco === null || p.preco === undefined ? null : Number(p.preco),
      detalhes: (p.detalhes as string | null) ?? null, publico: (p.publico as string | null) ?? null, link: (p.link as string | null) ?? null,
      criativosAprovados: aprovados.get(p.id as string) ?? 0,
    })),
    campanhas: (campanhasR.data ?? []).map((c): CampanhaExistente => ({
      produto_id: (c.produto_id as string | null) ?? null, plataforma: c.plataforma as string, status: c.status as string,
      origem: c.origem as string, criado_em: c.criado_em as string, oportunidade: ((c as { oportunidade?: string | null }).oportunidade) ?? null,
    })),
    limites,
    mes: await situacaoDoMes(db, workspaceId, limites.mensalMax),
    canais,
    aprendizados: (aprendizadosR.data ?? []).map((a) => `${a.categoria}: ${a.texto}`),
  };
}

function dependencias(db: Admin): Dependencias {
  return {
    iaPronta: () => iaConfigurada(),
    motivoSemIa: () => mensagemSemChave(),
    carregarContexto: (ws) => carregarContexto(db, ws),
    pedirPlano: (sistema, usuario) => pedirJson({ schema: planoIaSchema, sistema, usuario, maxTokens: 12000 }),
    async salvar(pedido, proposta) {
      // Os anúncios aceitos viram textos no Creative Studio (rascunho), ligados à campanha.
      const lote = randomUUID();
      const { data: criativos } = await db.from("criativos").insert(proposta.plano.anuncios.map((a) => ({
        workspace_id: pedido.workspaceId, produto_id: proposta.produto.id, criado_por: pedido.usuarioId, origem: "ia", lote,
        formato: a.formato, plataforma: proposta.rascunho.plataforma, titulo: a.titulo.slice(0, 200), descricao: a.descricao.slice(0, 500),
        cta: a.cta.slice(0, 80), texto: a.texto.slice(0, 3000), status: "rascunho",
      }))).select("id");
      const salvo = await gravarRascunho(
        db, pedido.workspaceId, pedido.usuarioId, "diretor",
        { ...proposta.rascunho, criativo_ids: (criativos ?? []).map((c) => c.id as string).slice(0, 6) },
        { plano: proposta.plano, oportunidade: proposta.plano.oportunidade.tipo },
      );
      return "erro" in salvo ? { erro: salvo.erro } : { id: salvo.id };
    },
  };
}

/** Registro de execução em cmo_execucoes. Sem a tabela (antes da migração) o trabalho roda do mesmo jeito, sem registro. */
function registroDe(db: Admin, info: { workspaceId: string; origem: "cron" | "manual"; modo: string; usuarioId: string | null }): Registro {
  return {
    async abrir() {
      const { data, error } = await db.from("cmo_execucoes").insert({
        workspace_id: info.workspaceId, dia: hojeEmBrasilia(), origem: info.origem, modo: info.modo, usuario_id: info.usuarioId,
      }).select("id").single();
      // 23505 = já existe o ciclo diário deste dia (índice único): é a trava de idempotência.
      if (error?.code === "23505") return { situacao: "duplicada" };
      return { situacao: "aberta", id: (data?.id as string | undefined) ?? null };
    },
    async fechar(id, f) {
      if (!id) return;
      await db.from("cmo_execucoes").update({
        terminado_em: new Date().toISOString(), status: f.status, etapas: f.etapas, resultado: f.resultado, rascunho_id: f.rascunhoId,
      }).eq("id", id).eq("workspace_id", info.workspaceId);
    },
  };
}

/** Pedido de uma pessoa (criar automaticamente, criar com respostas, gerar de uma ideia). */
export function criarCampanha(db: Admin, pedido: PedidoDeCampanha): Promise<ResultadoDaGeracao> {
  const registro = registroDe(db, { workspaceId: pedido.workspaceId, origem: "manual", modo: pedido.modo, usuarioId: pedido.usuarioId });
  return executarComRegistro(registro, () => gerarCampanha(dependencias(db), pedido));
}

export function ideiasDeCampanha(db: Admin, workspaceId: string, usuarioId: string | null): Promise<ResultadoDeIdeias> {
  const deps: DependenciasDeIdeias = {
    iaPronta: () => iaConfigurada(),
    motivoSemIa: () => mensagemSemChave(),
    carregarContexto: (ws) => carregarContexto(db, ws),
    pedirIdeias: (sistema, usuario) => pedirJson({ schema: ideiasIaSchema, sistema, usuario, maxTokens: 6000 }),
    async salvar(ws, usuario, ideias, modelo) {
      // As ideias antigas ainda não usadas saem da tela: ficam só as desta rodada.
      await db.from("campanha_ideias").update({ status: "descartada" }).eq("workspace_id", ws).eq("status", "nova");
      const { error } = await db.from("campanha_ideias").insert(ideias.map((i) => ({
        workspace_id: ws, criado_por: usuario, produto_id: i.produtoId, oportunidade: i.oportunidade, plataforma: i.plataforma,
        objetivo: i.objetivo, titulo: i.titulo, detalhes: i.detalhes, orcamento_sugerido: i.orcamentoSugerido, modelo: modelo.slice(0, 80),
      })));
      return error ? "Não foi possível guardar as ideias. Aplique a migração da CMO autônoma no Supabase (veja docs/PENDENTE.md)." : null;
    },
  };
  return gerarIdeias(deps, workspaceId, usuarioId);
}

export async function lerNivel(db: Admin, workspaceId: string): Promise<Nivel> {
  // "*" de propósito: antes da migração a coluna nivel não existe e a leitura por nome falharia.
  const { data } = await db.from("autonomia").select("*").eq("workspace_id", workspaceId).maybeSingle();
  return nivelEfetivo(data);
}

/** MONITORAMENTO: leva as campanhas ligadas para aprendizado, otimização ou "pausada pela JUDITE", conforme a plataforma mostra. */
export async function monitorarCampanhas(db: Admin, workspaceId: string): Promise<string> {
  const { data: ligadas } = await db.from("campanha_rascunhos").select("id, status, plataforma, campanha_externa_id")
    .eq("workspace_id", workspaceId).in("status", [...RODANDO]).eq("simulada", false).not("campanha_externa_id", "is", null).limit(100);
  if (!ligadas?.length) return "Nenhuma campanha da JUDITE ligada nas plataformas.";

  const desde = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [{ data: naPlataforma }, { data: metricas }, { data: pausas }] = await Promise.all([
    db.from("trafego_campanhas").select("plataforma, campanha_id, status").eq("workspace_id", workspaceId),
    db.from("trafego_metricas_dia").select("plataforma, campanha_id, data, impressoes, gasto").eq("workspace_id", workspaceId).gte("data", desde).limit(50000),
    db.from("trafego_acoes").select("plataforma, entidade_id").eq("workspace_id", workspaceId).eq("origem", "automacao")
      .eq("acao", "pausar").eq("status", "aplicada").gte("criado_em", desde).limit(500),
  ]);
  const repo = repositorioDeEstados(db);
  let mudancas = 0;
  for (const c of ligadas) {
    if (!ehEstado(c.status)) continue;
    const igual = (l: { plataforma: unknown; campanha_id?: unknown; entidade_id?: unknown }) =>
      l.plataforma === c.plataforma && (l.campanha_id ?? l.entidade_id) === c.campanha_externa_id;
    const linha = (naPlataforma ?? []).find(igual);
    if (!linha) continue;
    const dias = new Set((metricas ?? []).filter(igual).filter((m) => Number(m.impressoes) > 0 || Number(m.gasto) > 0).map((m) => m.data)).size;
    const para = proximoEstadoMonitorado(c.status, {
      diasComDados: dias, ativaNaPlataforma: campanhaAtiva(linha.status as string | null), pausadaPelaAutomacao: (pausas ?? []).some(igual),
    });
    if (!para) continue;
    const r = await mudarEstado(repo, {
      workspaceId, rascunhoId: c.id as string, de: c.status, para, ator: para === "pausada_pela_ia" ? "ia" : "sistema", usuarioId: null,
      motivo: para === "pausada_pela_ia" ? "A autonomia pausou a campanha na plataforma." : `${dias} dia(s) com entrega na plataforma.`,
    });
    if (r.ok) mudancas += 1;
  }
  return `${ligadas.length} campanha(s) ligada(s) conferida(s); ${mudancas} mudaram de situação.`;
}

/** O ciclo diário de um workspace. Chamado só pelo cron, depois de conferido o segredo. */
export function cicloDiarioDoWorkspace(db: Admin, workspaceId: string): Promise<ResultadoDoCiclo> {
  const pedido: PedidoDeCampanha = { workspaceId, usuarioId: null, modo: "diario" };
  return cicloDiario({
    nivel: () => lerNivel(db, workspaceId),
    registro: registroDe(db, { workspaceId, origem: "cron", modo: "diario", usuarioId: null }),
    monitorar: () => monitorarCampanhas(db, workspaceId),
    gerar: () => gerarCampanha(dependencias(db), pedido),
  });
}
