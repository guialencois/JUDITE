/**
 * O único caminho para mudar uma campanha de verdade (pausar, ativar, mudar orçamento diário).
 * É usado pela rota /api/trafego/acoes (tela), pelas aprovações do Diretor e pela autonomia.
 *
 * Mexe em dinheiro, então, nesta ordem:
 *   1. a campanha precisa ser deste workspace (gravada pela sincronização);
 *   2. passa pelos freios de limites.ts com os limites do workspace (dia, % por ajuste e mês);
 *   3. acima de algum limite não aplica: registra "aguardando_aprovacao" e devolve o motivo;
 *      a automação NUNCA confirma sozinha, só um humano (confirmado = true vindo da tela);
 *   4. registra tudo em trafego_acoes, deu certo ou não.
 *
 * Quem chama já conferiu QUEM está pedindo (sessão com papel de dono/admin, ou segredo do cron).
 */

import { provedorDoWorkspace } from "@/lib/anuncios/provedor";
import type { createAdminClient } from "@/lib/supabase/admin";
import { estouroDoCanal, validarAtivacao, validarOrcamento } from "./limites";
import { lerLimites, situacaoDoMes } from "./mes";
import { NOME_PLATAFORMA, type AcaoAnuncio, type Plataforma } from "./tipos";

type Admin = ReturnType<typeof createAdminClient>;

export type PedidoAcao = {
  workspaceId: string;
  origem: "painel" | "automacao";
  /** Quem pediu (null quando é a automação). */
  usuarioId: string | null;
  plataforma: Plataforma;
  /** ID da campanha. Por enquanto só campanhas: são as únicas que a JUDITE sabe a que workspace pertencem. */
  entidadeId: string;
  entidadeNome?: string;
  acao: "pausar" | "ativar" | "definir_orcamento";
  valorReais?: number;
  /** Um humano viu o aviso do limite e confirmou. Ignorado quando a origem é a automação. */
  confirmado: boolean;
  /** Texto extra para o histórico (ex.: "Recomendação do Diretor aprovada"). */
  observacao?: string;
};

export type ResultadoAcao =
  | { tipo: "aplicada"; acao: PedidoAcao["acao"]; valor: string }
  | { tipo: "aguardando_aprovacao"; motivo: string; valor?: number }
  | { tipo: "recusada"; http: number; erro: string }
  | { tipo: "erro"; erro: string };

export async function executarAcao(db: Admin, p: PedidoAcao): Promise<ResultadoAcao> {
  const comecou = Date.now();
  const humanoConfirmou = p.origem === "painel" && p.confirmado;

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
    return { tipo: "recusada", http: 404, erro: "Campanha não encontrada neste workspace. Sincronize os dados primeiro." };
  }
  const conta = campanha.conta_externa as string;

  // Sem conexão com a plataforma não há o que fazer: avisa antes de qualquer outra coisa.
  const resolvido = await provedorDoWorkspace(db, p.workspaceId, p.plataforma);
  if (!resolvido.ok) return { tipo: "recusada", http: 409, erro: resolvido.motivo };
  const provedor = resolvido.provedor;

  const nome = p.entidadeNome ?? (campanha.nome as string | undefined) ?? p.entidadeId;
  const base = {
    workspace_id: p.workspaceId, usuario_id: p.usuarioId, origem: p.origem, plataforma: p.plataforma,
    tipo_entidade: "campanha", entidade_id: p.entidadeId, entidade_nome: nome, acao: p.acao,
  };
  const nota = (texto: string | undefined) => [p.observacao, texto].filter(Boolean).join(" · ").slice(0, 500) || null;

  const { data: cfg } = await db.from("trafego_config").select("chave, valor").eq("workspace_id", p.workspaceId);
  const limites = lerLimites(cfg);
  const atual = campanha.orcamento_diario === null || campanha.orcamento_diario === undefined
    ? null : Number(campanha.orcamento_diario);

  let acao: AcaoAnuncio;
  let antes: string | null;
  let depois: string;

  const aguardar = async (motivo: string, valor?: number): Promise<ResultadoAcao> => {
    await db.from("trafego_acoes").insert({
      ...base, valor_antes: antes, valor_depois: depois, status: "aguardando_aprovacao", resultado: nota(motivo),
    });
    return { tipo: "aguardando_aprovacao", motivo, valor };
  };

  // Canal bloqueado na governança: a automação não age nele (pausar continua sempre permitido).
  if (p.origem === "automacao" && p.acao !== "pausar" && limites.bloqueadas.includes(p.plataforma)) {
    antes = null;
    depois = p.acao === "ativar" ? provedor.statusAtiva : String(p.valorReais ?? "");
    return aguardar(`${NOME_PLATAFORMA[p.plataforma]} está bloqueado para ações automáticas nos Limites da IA.`);
  }
  /** Teto do mês só deste canal (quando o workspace definiu um). Devolve o motivo quando estoura. */
  const tetoDoCanal = async (novoPorDia: number): Promise<string | null> => {
    const max = limites.mensalPorCanal[p.plataforma];
    if (!(max > 0)) return null;
    const canal = await situacaoDoMes(db, p.workspaceId, max, { plataforma: p.plataforma, campanhaId: p.entidadeId }, p.plataforma);
    return estouroDoCanal(canal, novoPorDia, NOME_PLATAFORMA[p.plataforma]);
  };

  if (p.acao === "pausar" || p.acao === "ativar") {
    acao = { tipo: p.acao, plataforma: p.plataforma, conta, entidade: "campanha", entidadeId: p.entidadeId };
    antes = (campanha.status as string | null) ?? null;
    depois = p.acao === "ativar" ? provedor.statusAtiva : provedor.statusPausada;

    // Pausar é sempre permitido. Ligar gasta dinheiro: confere o teto do mês.
    if (p.acao === "ativar") {
      const mes = await situacaoDoMes(db, p.workspaceId, limites.mensalMax, { plataforma: p.plataforma, campanhaId: p.entidadeId });
      const checagem = validarAtivacao(atual, mes);
      if (checagem.precisaAprovacao && !humanoConfirmou) return aguardar(checagem.motivo ?? "Passa do orçamento mensal.");
      const canal = atual !== null && atual > 0 ? await tetoDoCanal(atual) : null;
      if (canal && !humanoConfirmou) return aguardar(canal);
    }
  } else {
    const mes = await situacaoDoMes(db, p.workspaceId, limites.mensalMax, { plataforma: p.plataforma, campanhaId: p.entidadeId });
    const checagem = validarOrcamento({
      atualReais: atual,
      novoReais: Number(p.valorReais),
      maxSemAprovacao: limites.maxSemAprovacao,
      aumentoMaxPercent: limites.aumentoMaxPercent,
      reducaoMaxPercent: limites.reducaoMaxPercent,
      mes,
    });
    if (!checagem.ok) return { tipo: "recusada", http: 400, erro: checagem.motivo ?? "Valor inválido." };

    antes = atual === null ? null : String(atual);
    depois = String(checagem.valorFinal);

    // A automação nunca confirma sozinha: acima de qualquer limite, espera um humano.
    if (checagem.precisaAprovacao && !humanoConfirmou) {
      return aguardar(checagem.motivo ?? "Acima dos limites.", checagem.valorFinal);
    }
    // Teto por canal: só para aumento (reduzir nunca é barrado por causa do mês).
    const canal = atual !== null && checagem.valorFinal > atual ? await tetoDoCanal(checagem.valorFinal) : null;
    if (canal && !humanoConfirmou) return aguardar(canal, checagem.valorFinal);
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
      resultado: nota(JSON.stringify(resultado ?? null)), duracao_ms: Date.now() - comecou,
    });
    return { tipo: "aplicada", acao: p.acao, valor: depois };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await db.from("trafego_acoes").insert({
      ...base, valor_antes: antes, valor_depois: depois, status: "erro",
      resultado: nota(mensagem), duracao_ms: Date.now() - comecou,
    });
    return { tipo: "erro", erro: mensagem };
  }
}
