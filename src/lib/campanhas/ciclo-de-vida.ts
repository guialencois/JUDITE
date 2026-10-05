/**
 * Ciclo de vida de uma campanha depois de criada: pausar, retomar, concluir e editar a proposta.
 * SOMENTE no servidor, depois de conferir quem pediu. Toda mudança passa pela máquina de estados
 * (src/lib/cmo/estados.ts) e fica no histórico. Na campanha real, mexer na plataforma passa por
 * executarAcao (freios + histórico de ações); na simulada, nada é chamado fora da JUDITE.
 */

import { ehEstado, mudarEstado, RODANDO, type Estado } from "@/lib/cmo/estados";
import { registrarEvento, repositorioDeEstados } from "@/lib/cmo/estados-db";
import type { createAdminClient } from "@/lib/supabase/admin";
import { executarAcao } from "@/lib/trafego/executar";
import { lerLimites, situacaoDoMes } from "@/lib/trafego/mes";
import type { Plataforma } from "@/lib/trafego/tipos";
import { conferirRascunho, rascunhoSchema } from "./rascunho";

type Admin = ReturnType<typeof createAdminClient>;
export type Resultado = { ok: true; mensagem: string } | { ok: false; motivo: string };
export type AcaoDeVida = "pausar" | "retomar" | "concluir";

const DESTINO: Record<AcaoDeVida, Estado> = { pausar: "pausada", retomar: "ativa", concluir: "concluida" };

export async function mudarCampanha(db: Admin, workspaceId: string, rascunhoId: string, usuarioId: string, acao: AcaoDeVida): Promise<Resultado> {
  const { data: r } = await db.from("campanha_rascunhos").select("status, simulada, plataforma, nome, campanha_externa_id")
    .eq("id", rascunhoId).eq("workspace_id", workspaceId).maybeSingle();
  if (!r || !ehEstado(r.status)) return { ok: false, motivo: "Campanha não encontrada." };
  const de = r.status;
  const para = DESTINO[acao];
  const rodando = RODANDO.includes(de);

  // Na plataforma: pausar (e concluir uma campanha ligada) desliga; retomar liga e por isso passa pelos freios do mês.
  const precisaMexerNaPlataforma = !r.simulada && r.campanha_externa_id && (acao === "retomar" || rodando);
  if (precisaMexerNaPlataforma) {
    const executado = await executarAcao(db, {
      workspaceId, origem: "painel", usuarioId, plataforma: r.plataforma as Plataforma, entidadeId: r.campanha_externa_id as string,
      entidadeNome: r.nome as string, acao: acao === "retomar" ? "ativar" : "pausar", confirmado: true,
      observacao: acao === "retomar" ? "Campanha retomada pelo dono" : acao === "concluir" ? "Campanha concluída (pausada na plataforma)" : "Campanha pausada por uma pessoa",
    });
    if (executado.tipo !== "aplicada") {
      return { ok: false, motivo: executado.tipo === "aguardando_aprovacao" ? executado.motivo : executado.erro };
    }
  }

  const mudou = await mudarEstado(repositorioDeEstados(db), {
    workspaceId, rascunhoId, de, para, ator: "pessoa", usuarioId,
    motivo: acao === "pausar" ? "Pausada por uma pessoa." : acao === "retomar" ? "Retomada pelo dono." : "Concluída por uma pessoa.",
    campos: { resultado: acao === "concluir" ? "Campanha concluída." : acao === "pausar" ? "Campanha pausada." : "Campanha retomada." },
  });
  if (!mudou.ok) return mudou;
  return { ok: true, mensagem: r.simulada ? "Feito em modo simulado: nada mudou na plataforma." : "Feito." };
}

/** Editar uma proposta que ainda aguarda aprovação: nome, orçamento e público. Passa pelos mesmos freios de um rascunho novo. */
export async function editarProposta(
  db: Admin, workspaceId: string, rascunhoId: string, usuarioId: string,
  novo: { nome: string; orcamento: number; regiao: string; idadeMin: number | null; idadeMax: number | null; interesses: string },
): Promise<Resultado> {
  const { data: r } = await db.from("campanha_rascunhos").select("status, plataforma, objetivo, orcamento_diario, produto_id, criativo_ids, justificativa")
    .eq("id", rascunhoId).eq("workspace_id", workspaceId).maybeSingle();
  if (!r) return { ok: false, motivo: "Proposta não encontrada." };
  if (r.status !== "aguardando_aprovacao") return { ok: false, motivo: "Só dá para editar uma proposta que ainda aguarda aprovação." };

  const lido = rascunhoSchema.safeParse({
    plataforma: r.plataforma, objetivo: r.objetivo, nome: novo.nome, orcamento_diario: novo.orcamento,
    publico: { regiao: novo.regiao, idade_min: novo.idadeMin, idade_max: novo.idadeMax, interesses: novo.interesses },
    produto_id: r.produto_id, criativo_ids: r.criativo_ids ?? [], justificativa: r.justificativa ?? "",
  });
  if (!lido.success) return { ok: false, motivo: "Confira os dados: nome (mínimo 3 letras), orçamento maior que zero e idades entre 18 e 65." };

  const [{ data: cfg }, { data: conexoes }] = await Promise.all([
    db.from("trafego_config").select("chave, valor").eq("workspace_id", workspaceId),
    db.from("conexoes").select("provedor, conectado_em").eq("workspace_id", workspaceId),
  ]);
  const limites = lerLimites(cfg);
  const teto = limites.mensalPorCanal[lido.data.plataforma as Plataforma];
  const conferido = conferirRascunho(lido.data, {
    maxSemAprovacao: limites.maxSemAprovacao,
    mes: await situacaoDoMes(db, workspaceId, limites.mensalMax),
    canal: teto > 0 ? await situacaoDoMes(db, workspaceId, teto, undefined, lido.data.plataforma) : null,
    plataformasConectadas: (conexoes ?? []).filter((c) => c.conectado_em).map((c) => c.provedor as string),
    criativosValidos: lido.data.criativo_ids,
  });
  if (conferido.erro) return { ok: false, motivo: conferido.erro };

  const { data: salvo, error } = await db.from("campanha_rascunhos").update({
    nome: lido.data.nome, orcamento_diario: lido.data.orcamento_diario, publico: lido.data.publico, avisos: conferido.avisos,
  }).eq("id", rascunhoId).eq("workspace_id", workspaceId).eq("status", "aguardando_aprovacao").select("id");
  if (error || !salvo?.length) return { ok: false, motivo: "A proposta mudou de situação enquanto você editava. Recarregue a página." };

  await registrarEvento(db, {
    workspaceId, rascunhoId, de: "aguardando_aprovacao", para: "aguardando_aprovacao", ator: "pessoa", usuarioId,
    motivo: `Proposta editada: orçamento de R$ ${Number(r.orcamento_diario).toFixed(2)} para R$ ${lido.data.orcamento_diario.toFixed(2)} por dia.`,
  });
  return { ok: true, mensagem: "Proposta atualizada." };
}
