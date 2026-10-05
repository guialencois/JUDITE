/**
 * Grava rascunhos de campanha. SOMENTE no servidor, e só depois de conferir quem pediu
 * (sessão de dono/admin ou segredo do cron). Usado pelo formulário "à mão" da página Campanhas
 * e pelo motor da CMO (src/lib/cmo).
 *
 * Um rascunho NUNCA cria nada na plataforma: ele fica "aguardando_aprovacao" até o dono decidir.
 */

import { registrarEvento } from "@/lib/cmo/estados-db";
import type { createAdminClient } from "@/lib/supabase/admin";
import { lerLimites, situacaoDoMes } from "@/lib/trafego/mes";
import { NOME_PLATAFORMA, type Plataforma } from "@/lib/trafego/tipos";
import { conferirRascunho, type Rascunho } from "./rascunho";

type Admin = ReturnType<typeof createAdminClient>;

export type Gravado = { id: string; avisos: string[] } | { erro: string };

/**
 * Confere o rascunho pelos freios e grava como aguardando aprovação, com registro no histórico de ações
 * e no histórico de estados. "extra" leva o plano completo da CMO (colunas da migração cmo_autonoma).
 */
export async function gravarRascunho(
  db: Admin, ws: string, usuarioId: string | null, origem: "painel" | "diretor", r: Rascunho,
  extra?: { plano: unknown; oportunidade: string },
): Promise<Gravado> {
  const [{ data: cfg }, { data: conexoes }, { data: criativos }] = await Promise.all([
    db.from("trafego_config").select("chave, valor").eq("workspace_id", ws),
    db.from("conexoes").select("provedor, conectado_em").eq("workspace_id", ws),
    db.from("criativos").select("id").eq("workspace_id", ws).neq("status", "arquivado"),
  ]);
  const limites = lerLimites(cfg);
  // Canal bloqueado na governança: nem à mão a JUDITE guarda campanha nova para ele.
  if (limites.bloqueadas.includes(r.plataforma as Plataforma)) {
    return { erro: `${NOME_PLATAFORMA[r.plataforma as Plataforma]} está bloqueado nos Limites da IA.` };
  }
  const tetoDoCanal = limites.mensalPorCanal[r.plataforma as Plataforma];
  const conferido = conferirRascunho(r, {
    maxSemAprovacao: limites.maxSemAprovacao,
    mes: await situacaoDoMes(db, ws, limites.mensalMax),
    canal: tetoDoCanal > 0 ? await situacaoDoMes(db, ws, tetoDoCanal, undefined, r.plataforma) : null,
    plataformasConectadas: (conexoes ?? []).filter((c) => c.conectado_em).map((c) => c.provedor as string),
    criativosValidos: (criativos ?? []).map((c) => c.id as string),
  });
  if (conferido.erro) return { erro: conferido.erro };

  const linha: Record<string, unknown> = {
    workspace_id: ws, criado_por: usuarioId, origem, plataforma: r.plataforma, nome: r.nome, objetivo: r.objetivo,
    orcamento_diario: r.orcamento_diario, publico: r.publico, produto_id: r.produto_id, criativo_ids: r.criativo_ids,
    justificativa: r.justificativa || null, avisos: conferido.avisos, status: "aguardando_aprovacao",
  };
  let { data: salvo, error } = await db.from("campanha_rascunhos")
    .insert(extra ? { ...linha, plano: extra.plano, oportunidade: extra.oportunidade } : linha).select("id").single();
  if (error && extra) {
    // Antes da migração cmo_autonoma as colunas do plano não existem: grava o essencial, sem esconder o motivo.
    ({ data: salvo, error } = await db.from("campanha_rascunhos").insert({
      ...linha, avisos: [...conferido.avisos, "O plano completo não foi guardado: falta aplicar a migração da CMO autônoma no Supabase."],
    }).select("id").single());
  }
  if (error || !salvo) return { erro: "Não foi possível salvar a proposta. Confira se as migrações das Etapas 8 e 9 foram aplicadas no Supabase." };
  const id = salvo.id as string;

  // Campanha nova sempre exige aprovação: fica registrado no histórico de ações do tráfego.
  await db.from("trafego_acoes").insert({
    workspace_id: ws, usuario_id: origem === "painel" ? usuarioId : null, origem: origem === "diretor" ? "automacao" : "painel",
    plataforma: r.plataforma, tipo_entidade: "campanha", entidade_id: id.slice(0, 36), entidade_nome: r.nome,
    acao: "criar_campanha_pausada", valor_antes: null, valor_depois: String(r.orcamento_diario), status: "aguardando_aprovacao",
    resultado: "Rascunho de campanha nova aguardando a aprovação do dono.",
  });
  await registrarEvento(db, {
    workspaceId: ws, rascunhoId: id, de: null, para: "aguardando_aprovacao", ator: origem === "diretor" ? "ia" : "pessoa", usuarioId,
    motivo: origem === "diretor" ? "Proposta montada pela JUDITE." : "Rascunho montado à mão.",
  });
  return { id, avisos: conferido.avisos };
}
