/**
 * Máquina de estados de uma campanha da JUDITE (coluna campanha_rascunhos.status).
 *
 *   rascunho → aguardando_aprovacao → publicada_pausada → ativa → aprendizado → otimizando → concluida
 *                     ↓                       ↓               ↘ pausada / pausada_pela_ia ↗
 *                  recusada                concluida
 *
 * Nenhuma mudança fora desta tabela é aceita, e toda mudança vira uma linha em campanha_eventos
 * (quem, quando, de onde para onde e por quê). Funções puras + um repositório injetado
 * (o do Supabase fica em estados-db.ts), para os testes rodarem sem banco.
 */

export const ESTADOS = [
  "rascunho", "aguardando_aprovacao", "publicada_pausada", "ativa", "aprendizado", "otimizando",
  "pausada", "pausada_pela_ia", "concluida", "recusada", "erro",
] as const;
export type Estado = (typeof ESTADOS)[number];

export const ROTULO_ESTADO: Record<Estado, string> = {
  rascunho: "rascunho",
  aguardando_aprovacao: "aguardando aprovação",
  publicada_pausada: "criada e pausada",
  ativa: "ativa",
  aprendizado: "ativa · em aprendizado",
  otimizando: "ativa · em otimização",
  pausada: "pausada por você",
  pausada_pela_ia: "pausada pela JUDITE",
  concluida: "concluída",
  recusada: "recusada",
  erro: "erro",
};

const TRANSICOES: Record<Estado, readonly Estado[]> = {
  rascunho: ["aguardando_aprovacao", "recusada"],
  aguardando_aprovacao: ["publicada_pausada", "recusada", "erro"],
  publicada_pausada: ["ativa", "concluida"],
  ativa: ["aprendizado", "otimizando", "pausada", "pausada_pela_ia", "concluida"],
  aprendizado: ["otimizando", "pausada", "pausada_pela_ia", "concluida"],
  otimizando: ["pausada", "pausada_pela_ia", "concluida"],
  pausada: ["ativa", "concluida"],
  pausada_pela_ia: ["ativa", "concluida"],
  erro: ["aguardando_aprovacao", "recusada"],
  concluida: [],
  recusada: [],
};

/** A campanha existe (ou vai existir) e ocupa o lugar: não se propõe outra igual. */
export const EM_ANDAMENTO: readonly Estado[] = [
  "aguardando_aprovacao", "publicada_pausada", "ativa", "aprendizado", "otimizando", "pausada", "pausada_pela_ia",
];
/** A campanha está gastando dinheiro (ligada na plataforma). */
export const RODANDO: readonly Estado[] = ["ativa", "aprendizado", "otimizando"];

export const ehEstado = (v: unknown): v is Estado => typeof v === "string" && (ESTADOS as readonly string[]).includes(v);
export const podeTransitar = (de: Estado, para: Estado): boolean => TRANSICOES[de].includes(para);
export const proximosEstados = (de: Estado): readonly Estado[] => TRANSICOES[de];

export type Ator = "pessoa" | "ia" | "sistema";
export type Evento = {
  workspaceId: string;
  rascunhoId: string;
  de: Estado | null;
  para: Estado;
  ator: Ator;
  usuarioId: string | null;
  motivo: string;
};

export type RepositorioDeEstados = {
  /**
   * Muda o estado SÓ se a campanha ainda estiver em "de" (comparação no próprio UPDATE).
   * Devolve false quando nenhuma linha mudou: outra pessoa (ou o mesmo clique, repetido) chegou antes.
   */
  mudar(workspaceId: string, rascunhoId: string, de: Estado, para: Estado, campos: Record<string, unknown>): Promise<boolean>;
  registrar(evento: Evento): Promise<void>;
};

export type Mudanca = Omit<Evento, "de"> & { de: Estado; campos?: Record<string, unknown> };
export type ResultadoMudanca = { ok: true } | { ok: false; motivo: string };

/** Aplica uma transição válida e registra o evento. Idempotente: repetir o mesmo pedido não muda nada nem duplica o histórico. */
export async function mudarEstado(repo: RepositorioDeEstados, m: Mudanca): Promise<ResultadoMudanca> {
  if (!podeTransitar(m.de, m.para)) {
    return { ok: false, motivo: `Uma campanha "${ROTULO_ESTADO[m.de]}" não pode passar para "${ROTULO_ESTADO[m.para]}".` };
  }
  const mudou = await repo.mudar(m.workspaceId, m.rascunhoId, m.de, m.para, m.campos ?? {});
  if (!mudou) return { ok: false, motivo: "Essa campanha já mudou de situação. Recarregue a página." };
  await repo.registrar({ workspaceId: m.workspaceId, rascunhoId: m.rascunhoId, de: m.de, para: m.para, ator: m.ator, usuarioId: m.usuarioId, motivo: m.motivo });
  return { ok: true };
}

/** Dias com entrega antes de uma campanha sair do aprendizado (o mesmo prazo das regras do Diretor). */
export const DIAS_DE_APRENDIZADO = 7;

/**
 * Monitoramento: para onde uma campanha ligada deve ir, olhando o que a plataforma mostra.
 * Devolve null quando fica como está. Só o sistema usa; não liga nem desliga nada na plataforma.
 */
export function proximoEstadoMonitorado(
  estado: Estado,
  dados: { diasComDados: number; ativaNaPlataforma: boolean; pausadaPelaAutomacao: boolean },
): Estado | null {
  if (!RODANDO.includes(estado)) return null;
  if (!dados.ativaNaPlataforma) return dados.pausadaPelaAutomacao ? "pausada_pela_ia" : null;
  if (estado === "ativa" && dados.diasComDados > 0 && dados.diasComDados < DIAS_DE_APRENDIZADO) return "aprendizado";
  if (estado !== "otimizando" && dados.diasComDados >= DIAS_DE_APRENDIZADO) return "otimizando";
  return null;
}
