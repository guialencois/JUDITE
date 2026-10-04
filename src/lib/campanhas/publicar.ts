/**
 * Publicação e ativação de campanhas do Campaign Manager. SOMENTE no servidor,
 * e só depois de conferir que quem pediu é o DONO do workspace.
 *
 *  - publicarRascunho: cria a campanha PAUSADA na plataforma (ou simula) e registra em trafego_acoes.
 *  - ativarRascunho:   liga a campanha. É outra aprovação e passa pelos freios do mês (executarAcao).
 *
 * Modo simulado (padrão): sem JUDITE_PUBLICACAO_REAL=1 nenhuma API de plataforma é chamada;
 * o fluxo inteiro acontece só dentro da JUDITE, marcado como "simulada".
 */

import { randomUUID } from "node:crypto";
import { provedorDoWorkspace, type ProvedorAnuncios } from "@/lib/anuncios/provedor";
import type { createAdminClient } from "@/lib/supabase/admin";
import { executarAcao } from "@/lib/trafego/executar";
import { validarAtivacao } from "@/lib/trafego/limites";
import { lerLimites, situacaoDoMes } from "@/lib/trafego/mes";
import type { Plataforma } from "@/lib/trafego/tipos";
import { publicacaoReal, type Objetivo } from "./rascunho";

type Admin = ReturnType<typeof createAdminClient>;
export type Resultado = { ok: true; simulada: boolean; mensagem: string } | { ok: false; motivo: string };

type Opcoes = {
  /** Para os testes: força o modo e injeta um provedor falso. */
  real?: boolean;
  provedor?: ProvedorAnuncios;
};

export async function publicarRascunho(db: Admin, workspaceId: string, rascunhoId: string, usuarioId: string, opcoes: Opcoes = {}): Promise<Resultado> {
  const { data: r } = await db.from("campanha_rascunhos").select("*")
    .eq("id", rascunhoId).eq("workspace_id", workspaceId).eq("status", "aguardando_aprovacao").maybeSingle();
  if (!r) return { ok: false, motivo: "Esse rascunho já foi decidido ou não existe mais." };

  const real = opcoes.real ?? publicacaoReal();
  const plataforma = r.plataforma as Plataforma;
  const orcamento = Number(r.orcamento_diario);
  const agora = new Date().toISOString();
  const comecou = Date.now();
  const historico = {
    workspace_id: workspaceId, usuario_id: usuarioId, origem: "painel", plataforma, tipo_entidade: "campanha",
    entidade_nome: r.nome as string, acao: "criar_campanha_pausada", valor_antes: null, valor_depois: String(orcamento),
  };

  if (!real) {
    const idSimulado = "SIMULADA-" + randomUUID().slice(0, 8);
    await db.from("campanha_rascunhos").update({
      status: "publicada_pausada", simulada: true, campanha_externa_id: idSimulado, decidido_por: usuarioId, decidido_em: agora,
      resultado: "Simulação: nada foi criado na plataforma.",
    }).eq("id", rascunhoId).eq("workspace_id", workspaceId);
    await db.from("trafego_acoes").insert({
      ...historico, entidade_id: idSimulado, status: "aplicada", resultado: "SIMULAÇÃO: campanha aprovada; nada foi criado na plataforma.",
      duracao_ms: Date.now() - comecou,
    });
    return { ok: true, simulada: true, mensagem: "Aprovado em modo simulado: nada foi criado na plataforma." };
  }

  const falhar = async (motivo: string): Promise<Resultado> => {
    await db.from("campanha_rascunhos").update({ status: "erro", decidido_por: usuarioId, decidido_em: agora, resultado: motivo.slice(0, 500) })
      .eq("id", rascunhoId).eq("workspace_id", workspaceId);
    await db.from("trafego_acoes").insert({
      ...historico, entidade_id: rascunhoId.slice(0, 36), status: "erro", resultado: motivo.slice(0, 500), duracao_ms: Date.now() - comecou,
    });
    return { ok: false, motivo };
  };

  let provedor = opcoes.provedor;
  if (!provedor) {
    const resolvido = await provedorDoWorkspace(db, workspaceId, plataforma);
    if (!resolvido.ok) return falhar(resolvido.motivo);
    provedor = resolvido.provedor;
  }
  if (!provedor.criarCampanhaPausada) {
    return falhar(`Criar campanha por aqui ainda não está disponível para ${provedor.nome}. Crie a campanha na própria plataforma seguindo o rascunho.`);
  }
  const { data: conta } = await db.from("trafego_contas").select("conta_externa")
    .eq("workspace_id", workspaceId).eq("plataforma", plataforma).eq("ativo", true).limit(1).maybeSingle();
  if (!conta) return falhar("Nenhuma conta de anúncios dessa plataforma está ligada ao workspace.");

  try {
    const criada = await provedor.criarCampanhaPausada({
      conta: conta.conta_externa as string, nome: r.nome as string, objetivo: r.objetivo as Objetivo, orcamentoDiarioReais: orcamento,
    });
    // Entra no Gerenciador já PAUSADA, para a ativação passar pelos mesmos freios das outras campanhas.
    await db.from("trafego_campanhas").upsert({
      workspace_id: workspaceId, plataforma, campanha_id: criada.campanhaId, conta_externa: conta.conta_externa,
      nome: r.nome, status: provedor.statusPausada, orcamento_diario: orcamento, atualizado_em: agora,
    }, { onConflict: "workspace_id,plataforma,campanha_id" });
    await db.from("campanha_rascunhos").update({
      status: "publicada_pausada", simulada: false, campanha_externa_id: criada.campanhaId, decidido_por: usuarioId, decidido_em: agora,
      resultado: "Campanha criada PAUSADA na plataforma.",
    }).eq("id", rascunhoId).eq("workspace_id", workspaceId);
    await db.from("trafego_acoes").insert({
      ...historico, entidade_id: criada.campanhaId, status: "aplicada", resultado: "Campanha criada PAUSADA.", duracao_ms: Date.now() - comecou,
    });
    return { ok: true, simulada: false, mensagem: "Campanha criada PAUSADA na plataforma." };
  } catch (erro) {
    return falhar(erro instanceof Error ? erro.message : "A plataforma recusou a criação.");
  }
}

/** Ativação: segunda aprovação do dono. Na campanha real, passa por executarAcao (freios + histórico). */
export async function ativarRascunho(db: Admin, workspaceId: string, rascunhoId: string, usuarioId: string): Promise<Resultado> {
  const { data: r } = await db.from("campanha_rascunhos").select("*")
    .eq("id", rascunhoId).eq("workspace_id", workspaceId).eq("status", "publicada_pausada").maybeSingle();
  if (!r) return { ok: false, motivo: "Essa campanha não está aguardando ativação." };
  const agora = new Date().toISOString();
  const marcarAtiva = (resultado: string) => db.from("campanha_rascunhos")
    .update({ status: "ativa", ativado_por: usuarioId, ativado_em: agora, resultado })
    .eq("id", rascunhoId).eq("workspace_id", workspaceId);

  if (r.simulada) {
    // Mesmo na simulação os freios são conferidos, para o teste mostrar o comportamento de verdade.
    const { data: cfg } = await db.from("trafego_config").select("chave, valor").eq("workspace_id", workspaceId);
    const mes = await situacaoDoMes(db, workspaceId, lerLimites(cfg).mensalMax);
    const checagem = validarAtivacao(Number(r.orcamento_diario), mes);
    const nota = checagem.precisaAprovacao ? ` Aviso dos freios: ${checagem.motivo}` : "";
    await marcarAtiva("Simulação: ativação aprovada pelo dono; nada mudou na plataforma." + nota);
    await db.from("trafego_acoes").insert({
      workspace_id: workspaceId, usuario_id: usuarioId, origem: "painel", plataforma: r.plataforma, tipo_entidade: "campanha",
      entidade_id: r.campanha_externa_id, entidade_nome: r.nome, acao: "ativar", valor_antes: "PAUSADA", valor_depois: "ATIVA",
      status: "aplicada", resultado: ("SIMULAÇÃO: ativação aprovada; nada mudou na plataforma." + nota).slice(0, 500),
    });
    return { ok: true, simulada: true, mensagem: "Ativação simulada." + nota };
  }

  const resultado = await executarAcao(db, {
    workspaceId, origem: "painel", usuarioId, plataforma: r.plataforma as Plataforma, entidadeId: r.campanha_externa_id as string,
    entidadeNome: r.nome as string, acao: "ativar", confirmado: true, observacao: "Ativação aprovada pelo dono no Campaign Manager",
  });
  if (resultado.tipo === "aplicada") {
    await marcarAtiva("Campanha ativada na plataforma.");
    return { ok: true, simulada: false, mensagem: "Campanha ativada." };
  }
  const motivo = resultado.tipo === "aguardando_aprovacao" ? resultado.motivo : resultado.erro;
  await db.from("campanha_rascunhos").update({ resultado: ("Ativação não aplicada: " + motivo).slice(0, 500) })
    .eq("id", rascunhoId).eq("workspace_id", workspaceId);
  return { ok: false, motivo };
}
