/**
 * POST /api/trafego/acoes
 * Pausa, ativa ou muda o orçamento diário de uma campanha DE VERDADE.
 * Mexe em dinheiro, então, nesta ordem:
 *   1. valida o pedido (zod);
 *   2. só dono ou admin do workspace (ou a automação, com o segredo do cron);
 *   3. passa pelos freios de limites.ts com os limites do workspace;
 *   4. acima do teto não aplica: registra "aguardando_aprovacao" e devolve 409;
 *   5. registra tudo em trafego_acoes, deu certo ou não.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { provedorDoWorkspace } from "@/lib/anuncios/provedor";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";
import { validarOrcamento } from "@/lib/trafego/limites";
import { ehChamadaDoCron } from "@/lib/trafego/segredo";
import type { AcaoAnuncio } from "@/lib/trafego/tipos";

export const runtime = "nodejs";

const corpoSchema = z.object({
  workspaceId: z.uuid(),
  origem: z.enum(["painel", "automacao"]).default("painel"),
  plataforma: z.enum(["google_ads", "facebook"]),
  // Por enquanto só campanhas: elas são as únicas que a JUDITE sabe a que workspace pertencem.
  tipoEntidade: z.literal("campanha").default("campanha"),
  entidadeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  entidadeNome: z.string().max(200).optional(),
  acao: z.enum(["pausar", "ativar", "definir_orcamento"]),
  valorReais: z.number().positive().max(1_000_000).optional(),
  confirmado: z.boolean().default(false),
});

export async function POST(req: Request) {
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  const p = parsed.data;

  // --- quem pode agir ---------------------------------------------------
  let usuarioId: string | null = null;
  if (p.origem === "automacao") {
    if (!ehChamadaDoCron(req)) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  } else {
    const acesso = await papelNoWorkspace(p.workspaceId);
    if (!acesso) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
    if (!podeAgir(acesso.papel)) {
      return NextResponse.json({ erro: "Só o dono ou um admin do workspace pode mudar campanhas." }, { status: 403 });
    }
    usuarioId = acesso.userId;
  }
  const db = createAdminClient();
  const comecou = Date.now();

  const { data: campanha } = await db
    .from("trafego_campanhas")
    .select("nome, conta_externa, status, orcamento_diario")
    .eq("workspace_id", p.workspaceId)
    .eq("plataforma", p.plataforma)
    .eq("campanha_id", p.entidadeId)
    .maybeSingle();

  // A campanha precisa ser deste workspace (gravada pela sincronização).
  // Assim ninguém age em uma campanha de outra conta só sabendo o ID dela.
  if (!campanha) {
    return NextResponse.json({ erro: "Campanha não encontrada neste workspace. Sincronize os dados primeiro." }, { status: 404 });
  }
  const conta = campanha.conta_externa as string;

  const nome = p.entidadeNome ?? (campanha.nome as string | undefined) ?? p.entidadeId;
  const base = {
    workspace_id: p.workspaceId, usuario_id: usuarioId, origem: p.origem, plataforma: p.plataforma,
    tipo_entidade: p.tipoEntidade, entidade_id: p.entidadeId, entidade_nome: nome, acao: p.acao,
  };

  // Sem conexão com a plataforma não há o que fazer: avisa antes de qualquer outra coisa.
  const resolvido = await provedorDoWorkspace(db, p.workspaceId, p.plataforma);
  if (!resolvido.ok) return NextResponse.json({ erro: resolvido.motivo }, { status: 409 });
  const provedor = resolvido.provedor;

  let acao: AcaoAnuncio;
  let antes: string | null;
  let depois: string;

  if (p.acao === "pausar" || p.acao === "ativar") {
    acao = { tipo: p.acao, plataforma: p.plataforma, conta, entidade: p.tipoEntidade, entidadeId: p.entidadeId };
    antes = (campanha.status as string | null) ?? null;
    depois = p.acao === "ativar" ? provedor.statusAtiva : provedor.statusPausada;
  } else {
    const { data: cfg } = await db.from("trafego_config").select("chave, valor").eq("workspace_id", p.workspaceId);
    const valorCfg = (k: string, padrao: number) => {
      const n = Number(cfg?.find((c) => c.chave === k)?.valor);
      return Number.isFinite(n) ? n : padrao;
    };
    const atual = campanha.orcamento_diario === null || campanha.orcamento_diario === undefined
      ? null : Number(campanha.orcamento_diario);
    const checagem = validarOrcamento({
      atualReais: atual,
      novoReais: Number(p.valorReais),
      maxSemAprovacao: valorCfg("orcamento_max_sem_aprovacao", 100),
      aumentoMaxPercent: valorCfg("aumento_max_por_vez_percent", 50),
    });
    if (!checagem.ok) return NextResponse.json({ erro: checagem.motivo }, { status: 400 });

    antes = atual === null ? null : String(atual);
    depois = String(checagem.valorFinal);

    // A automação nunca confirma sozinha: acima do teto, espera um humano.
    if (checagem.precisaAprovacao && (p.origem === "automacao" || !p.confirmado)) {
      await db.from("trafego_acoes").insert({
        ...base, valor_antes: antes, valor_depois: depois, status: "aguardando_aprovacao", resultado: checagem.motivo,
      });
      return NextResponse.json({ precisaAprovacao: true, motivo: checagem.motivo, valor: checagem.valorFinal }, { status: 409 });
    }
    acao = { tipo: "definir_orcamento", plataforma: p.plataforma, conta, campanhaId: p.entidadeId, valorReais: checagem.valorFinal };
  }

  try {
    const resultado = await provedor.executar(acao);
    await db.from("trafego_campanhas")
      .update(p.acao === "definir_orcamento"
        ? { orcamento_diario: Number(depois), atualizado_em: new Date().toISOString() }
        : { status: depois, atualizado_em: new Date().toISOString() })
      .eq("workspace_id", p.workspaceId).eq("plataforma", p.plataforma).eq("campanha_id", p.entidadeId);
    await db.from("trafego_acoes").insert({
      ...base, valor_antes: antes, valor_depois: depois, status: "aplicada",
      resultado: JSON.stringify(resultado ?? null).slice(0, 500), duracao_ms: Date.now() - comecou,
    });
    return NextResponse.json({ ok: true, acao: p.acao, valor: depois });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await db.from("trafego_acoes").insert({
      ...base, valor_antes: antes, valor_depois: depois, status: "erro",
      resultado: mensagem.slice(0, 500), duracao_ms: Date.now() - comecou,
    });
    return NextResponse.json({ erro: "A plataforma recusou a mudança. Veja o histórico de ações." }, { status: 502 });
  }
}
