/**
 * O ciclo diário da CMO (06h30 de Brasília, pelo cron) e o registro de cada execução.
 *
 *   acorda → confere o nível de autonomia → abre o registro do dia (idempotente) →
 *   monitora as campanhas ligadas → coleta, analisa, decide, gera, confere → põe na fila → fecha o registro
 *
 * Idempotente: o registro do dia é único por workspace. Se o cron disparar duas vezes, a segunda
 * não gera outra proposta. Cada etapa fica gravada em cmo_execucoes para a tela mostrar o que aconteceu.
 * Dependências injetadas (as reais ficam em servico.ts); testes em ciclo.test.ts.
 */

import type { Etapa, ResultadoDaGeracao } from "./gerar";
import { permissoes, type Nivel } from "./niveis";

export type Abertura = { situacao: "aberta"; id: string | null } | { situacao: "duplicada" };
export type Fechamento = { status: "ok" | "sem_proposta" | "erro"; etapas: Etapa[]; resultado: string; rascunhoId: string | null };

export type Registro = {
  /** Abre a execução. "duplicada" quando o ciclo diário deste dia já foi aberto. id null = sem tabela (antes da migração). */
  abrir(): Promise<Abertura>;
  fechar(id: string | null, f: Fechamento): Promise<void>;
};

/** Falhas que não são erro: a CMO olhou e não havia o que propor (ou não podia). */
const SEM_PROPOSTA = new Set(["sem_oportunidade", "orcamento", "sem_ia"]);

export function fechamentoDe(r: ResultadoDaGeracao, antes: Etapa[] = []): Fechamento {
  const etapas = [...antes, ...r.etapas];
  if (r.ok) return { status: "ok", etapas, resultado: `Proposta "${r.nome}" na fila.`, rascunhoId: r.rascunhoId };
  return { status: SEM_PROPOSTA.has(r.codigo) ? "sem_proposta" : "erro", etapas, resultado: r.motivo.slice(0, 500), rascunhoId: null };
}

/** Roda um trabalho da CMO com registro de execução (usado pelos pedidos manuais). */
export async function executarComRegistro(registro: Registro, trabalho: () => Promise<ResultadoDaGeracao>): Promise<ResultadoDaGeracao> {
  const aberta = await registro.abrir();
  const id = aberta.situacao === "aberta" ? aberta.id : null;
  const r = await trabalho();
  await registro.fechar(id, fechamentoDe(r));
  return r;
}

export type DependenciasDoCiclo = {
  nivel(): Promise<Nivel>;
  registro: Registro;
  /** Atualiza o estado das campanhas ligadas (aprendizado, otimização, pausada pela IA). Devolve um resumo em texto. */
  monitorar(): Promise<string>;
  gerar(): Promise<ResultadoDaGeracao>;
};

export type ResultadoDoCiclo =
  | { rodou: false; motivo: string }
  | { rodou: true; proposta: ResultadoDaGeracao; monitoramento: string };

export async function cicloDiario(deps: DependenciasDoCiclo): Promise<ResultadoDoCiclo> {
  const nivel = await deps.nivel();
  if (!permissoes(nivel).proporTodoDia) {
    return { rodou: false, motivo: "Autonomia no nível 0 (manual): a JUDITE só propõe quando alguém pede." };
  }
  const aberta = await deps.registro.abrir();
  if (aberta.situacao === "duplicada") return { rodou: false, motivo: "O ciclo de hoje já rodou para este workspace." };

  const inicio = Date.now();
  let monitoramento: string;
  let ok = true;
  try {
    monitoramento = await deps.monitorar();
  } catch {
    ok = false;
    monitoramento = "Não foi possível monitorar as campanhas ligadas.";
  }
  const etapaMonitor: Etapa = { etapa: "monitoramento", ok, detalhe: monitoramento.slice(0, 300), ms: Date.now() - inicio };

  let proposta: ResultadoDaGeracao;
  try {
    proposta = await deps.gerar();
  } catch {
    proposta = { ok: false, codigo: "coleta", motivo: "Erro inesperado ao montar a proposta do dia.", etapas: [] };
  }
  await deps.registro.fechar(aberta.id, fechamentoDe(proposta, [etapaMonitor]));
  return { rodou: true, proposta, monitoramento };
}
