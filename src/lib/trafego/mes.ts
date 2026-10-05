/**
 * Retrato do mês para o freio mensal e para a página Comercial.
 * As datas seguem o horário de Brasília (o mês "vira" à meia-noite daqui, não em UTC).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { PADRAO_AUMENTO_PERCENT, PADRAO_MAX_SEM_APROVACAO, PADRAO_MENSAL_MAX, PADRAO_REDUCAO_PERCENT, type SituacaoDoMes } from "./limites";
import { campanhaAtiva, PLATAFORMAS, type Plataforma } from "./tipos";

const FUSO = "America/Sao_Paulo";

/** Hoje em Brasília, como AAAA-MM-DD. */
export function hojeEmBrasilia(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(agora);
}

/** Limites de um mês "AAAA-MM": primeiro dia, último dia e quantos dias tem. */
export function limitesDoMes(mes: string): { inicio: string; fim: string; dias: number } {
  const [ano, m] = mes.split("-").map(Number);
  const dias = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(dias).padStart(2, "0")}`, dias };
}

/** Dias que faltam no mês, contando hoje. */
export function diasRestantesNoMes(hoje: string): number {
  const { dias } = limitesDoMes(hoje.slice(0, 7));
  return dias - Number(hoje.slice(8, 10)) + 1;
}

export const mesValido = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** "2026-10" -> "outubro de 2026" */
export function nomeDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(ano, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Mês anterior (-1) ou seguinte (+1), como "AAAA-MM". */
export function mesVizinho(mes: string, passo: number): string {
  const [ano, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(ano, m - 1 + passo, 15)).toISOString().slice(0, 7);
}

export type LimitesDoWorkspace = {
  maxSemAprovacao: number;
  aumentoMaxPercent: number;
  mensalMax: number;
  custosPercent: number;
  /** Maior redução de verba de uma vez sem aprovação. */
  reducaoMaxPercent: number;
  /** Teto de gasto no mês por canal (0 = sem teto próprio). */
  mensalPorCanal: Record<Plataforma, number>;
  /** Canais em que a JUDITE não propõe campanha nem age sozinha. */
  bloqueadas: Plataforma[];
};

/** Lê os limites do workspace; o que não estiver gravado cai no padrão seguro. */
export function lerLimites(cfg: { chave: string; valor: unknown }[] | null | undefined): LimitesDoWorkspace {
  const valor = (k: string, padrao: number) => {
    const linha = cfg?.find((c) => c.chave === k);
    const n = linha ? Number(linha.valor) : NaN;
    return Number.isFinite(n) ? n : padrao;
  };
  return {
    maxSemAprovacao: valor("orcamento_max_sem_aprovacao", PADRAO_MAX_SEM_APROVACAO),
    aumentoMaxPercent: valor("aumento_max_por_vez_percent", PADRAO_AUMENTO_PERCENT),
    mensalMax: valor("orcamento_mensal_max", PADRAO_MENSAL_MAX),
    custosPercent: valor("custos_percent", 25),
    reducaoMaxPercent: valor("reducao_max_por_vez_percent", PADRAO_REDUCAO_PERCENT),
    mensalPorCanal: Object.fromEntries(PLATAFORMAS.map((p) => [p, Math.max(0, valor("mensal_max_" + p, 0))])) as Record<Plataforma, number>,
    bloqueadas: PLATAFORMAS.filter((p) => valor("bloqueada_" + p, 0) >= 1),
  };
}

/**
 * Monta o retrato do mês corrente: gasto já sincronizado e o que as outras campanhas ligadas gastam por dia.
 * "ignorar" é a campanha que está sendo mudada (o orçamento dela entra pelo valor novo, não pelo antigo).
 */
export async function situacaoDoMes(
  db: SupabaseClient,
  workspaceId: string,
  mensalMax: number,
  ignorar?: { plataforma: string; campanhaId: string },
  /** Quando informado, conta só o gasto e as campanhas deste canal (para o teto por canal). */
  soPlataforma?: string,
): Promise<SituacaoDoMes> {
  const hoje = hojeEmBrasilia();
  const { inicio } = limitesDoMes(hoje.slice(0, 7));
  const gastosQ = db.from("trafego_metricas_dia").select("gasto").eq("workspace_id", workspaceId).gte("data", inicio).lte("data", hoje);
  const campanhasQ = db.from("trafego_campanhas").select("plataforma, campanha_id, status, orcamento_diario").eq("workspace_id", workspaceId);
  const [{ data: gastos }, { data: campanhas }] = await Promise.all([
    (soPlataforma ? gastosQ.eq("plataforma", soPlataforma) : gastosQ).limit(50000),
    soPlataforma ? campanhasQ.eq("plataforma", soPlataforma) : campanhasQ,
  ]);
  const gastoNoMes = (gastos ?? []).reduce((s, l) => s + Number(l.gasto ?? 0), 0);
  const outrasCampanhasPorDia = (campanhas ?? [])
    .filter((c) => campanhaAtiva(c.status as string | null))
    .filter((c) => !(ignorar && c.plataforma === ignorar.plataforma && c.campanha_id === ignorar.campanhaId))
    .reduce((s, c) => s + Number(c.orcamento_diario ?? 0), 0);
  return { gastoNoMes, outrasCampanhasPorDia, diasRestantes: diasRestantesNoMes(hoje), mensalMax };
}
