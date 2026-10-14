/**
 * Campaign Manager: rascunho de campanha, conferência pelos freios e o texto dos avisos.
 * Funções puras (testes em rascunho.test.ts). A publicação fica em publicar.ts.
 *
 * Fluxo: rascunho (aguardando_aprovacao) -> o DONO aprova -> a campanha é criada PAUSADA
 * -> ativar é OUTRA aprovação do dono, que passa pelos freios de orçamento do mês.
 */

import { z } from "zod";
import { estouroDoCanal, estouroMensal, TETO_ABSOLUTO_REAIS, type SituacaoDoMes } from "@/lib/trafego/limites";

export const OBJETIVOS = ["trafego", "mensagens", "conversoes", "reconhecimento"] as const;
export type Objetivo = (typeof OBJETIVOS)[number];

export const ROTULO_OBJETIVO: Record<Objetivo, string> = {
  trafego: "Visitas ao site",
  mensagens: "Conversas no WhatsApp / mensagens",
  conversoes: "Vendas / conversões",
  reconhecimento: "Alcance / reconhecimento",
};

export const publicoSchema = z.object({
  regiao: z.string().trim().max(200).default(""),
  idade_min: z.number().int().min(18).max(65).nullable().default(null),
  idade_max: z.number().int().min(18).max(65).nullable().default(null),
  interesses: z.string().trim().max(500).default(""),
});
export type Publico = z.infer<typeof publicoSchema>;

export const rascunhoSchema = z.object({
  plataforma: z.enum(["google_ads", "facebook", "tiktok"]),
  nome: z.string().trim().min(3).max(150),
  objetivo: z.enum(OBJETIVOS),
  orcamento_diario: z.number().positive().max(TETO_ABSOLUTO_REAIS),
  publico: publicoSchema,
  produto_id: z.uuid().nullable(),
  criativo_ids: z.array(z.uuid()).max(6),
  justificativa: z.string().trim().max(2000),
});
export type Rascunho = z.infer<typeof rascunhoSchema>;

export type ContextoRascunho = {
  maxSemAprovacao: number;
  mes: SituacaoDoMes;
  /** Situação do mês só do canal da campanha, quando o workspace definiu um teto por canal. */
  canal?: SituacaoDoMes | null;
  /** Conexões prontas (nomes da tabela conexoes: google_ads, meta, tiktok). */
  plataformasConectadas: string[];
  criativosValidos: string[];
};

const CONEXAO: Record<Rascunho["plataforma"], string> = { google_ads: "google_ads", facebook: "meta", tiktok: "tiktok" };

/**
 * Confere o rascunho contra os freios. "erro" impede de salvar; "avisos" acompanham o rascunho
 * para o dono ler antes de aprovar (campanha nova SEMPRE exige aprovação, com ou sem aviso).
 */
export function conferirRascunho(r: Rascunho, ctx: ContextoRascunho): { erro: string | null; avisos: string[] } {
  if (r.orcamento_diario > TETO_ABSOLUTO_REAIS) return { erro: "Orçamento acima do teto de segurança de R$ " + TETO_ABSOLUTO_REAIS + " por dia.", avisos: [] };
  if (r.publico.idade_min !== null && r.publico.idade_max !== null && r.publico.idade_min > r.publico.idade_max) {
    return { erro: "A idade mínima do público é maior que a máxima.", avisos: [] };
  }
  if (r.criativo_ids.some((id) => !ctx.criativosValidos.includes(id))) {
    return { erro: "O rascunho cita um criativo que não existe neste workspace.", avisos: [] };
  }
  const avisos: string[] = [];
  if (!ctx.plataformasConectadas.includes(CONEXAO[r.plataforma])) {
    avisos.push("A plataforma ainda não está conectada em Conexões; sem conexão a publicação real não acontece.");
  }
  if (r.orcamento_diario > ctx.maxSemAprovacao) {
    avisos.push(`O orçamento de R$ ${r.orcamento_diario.toFixed(2)} por dia está acima do teto de R$ ${ctx.maxSemAprovacao} que a JUDITE muda sozinha.`);
  }
  const mensal = estouroMensal(ctx.mes, r.orcamento_diario);
  if (mensal) avisos.push(mensal + " Isso vale para quando a campanha for ativada.");
  const doCanal = ctx.canal ? estouroDoCanal(ctx.canal, r.orcamento_diario, "este canal") : null;
  if (doCanal) avisos.push(doCanal + " Isso vale para quando a campanha for ativada.");
  if (!r.criativo_ids.length) avisos.push("Nenhum criativo escolhido: os anúncios terão de ser escritos na plataforma.");
  return { erro: null, avisos };
}

/** Publicação real só com a variável JUDITE_PUBLICACAO_REAL=1. Sem ela, tudo é simulado (padrão seguro). */
export const publicacaoReal = (): boolean => process.env.JUDITE_PUBLICACAO_REAL === "1";
