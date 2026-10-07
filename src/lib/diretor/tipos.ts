/**
 * Tipos do Diretor (CMO): o resumo dos dados que vai para a IA e o formato da resposta.
 * A resposta da IA é sempre validada com zod antes de ser gravada.
 */

import { z } from "zod";

export const TIPOS_RECOMENDACAO = [
  "pausar_campanha", "ativar_campanha", "ajustar_orcamento",
  "criativo", "site", "perfil_google", "seo", "comercial", "outro",
] as const;
export type TipoRecomendacao = (typeof TIPOS_RECOMENDACAO)[number];

/** Recomendações que mexem em campanha (e por isso exigem volume mínimo de dados). */
export const TIPOS_DE_VERBA: TipoRecomendacao[] = ["pausar_campanha", "ativar_campanha", "ajustar_orcamento"];

export const ROTULO_TIPO: Record<TipoRecomendacao, string> = {
  pausar_campanha: "Pausar campanha",
  ativar_campanha: "Ativar campanha",
  ajustar_orcamento: "Ajustar orçamento",
  criativo: "Criativo",
  site: "Site",
  perfil_google: "Perfil no Google",
  seo: "SEO / AEO",
  comercial: "Comercial",
  outro: "Outro",
};

/** O que a IA devolve. Mantido simples (texto, listas, números) para a saída estruturada da IA. */
export const respostaDiretorSchema = z.object({
  diagnostico: z.string(),
  pontos: z.array(z.object({
    tipo: z.enum(["positivo", "atencao", "critico", "informacao"]),
    titulo: z.string(),
    detalhe: z.string(),
  })),
  recomendacoes: z.array(z.object({
    tipo: z.enum(TIPOS_RECOMENDACAO),
    titulo: z.string(),
    justificativa: z.string(),
    impacto_esperado: z.string(),
    prioridade: z.enum(["alta", "media", "baixa"]),
    plataforma: z.enum(["google_ads", "facebook", "tiktok"]).nullable(),
    campanha_id: z.string().nullable(),
    valor_sugerido: z.number().nullable(),
  })),
});
export type RespostaDiretor = z.infer<typeof respostaDiretorSchema>;
export type RecomendacaoIA = RespostaDiretor["recomendacoes"][number];

export type TotaisSimples = { gasto: number; impressoes: number; cliques: number; compras: number; receita: number };

export type CampanhaResumo = TotaisSimples & {
  plataforma: string;
  campanha_id: string;
  nome: string;
  status: string | null;
  ativa: boolean;
  orcamento_diario: number | null;
  /** Em quantos dias da janela a campanha teve entrega (impressões ou gasto). */
  dias_com_dados: number;
  ctr: number | null;
  cpc: number | null;
};

export type ResumoDiretor = {
  hoje: string;
  janela: { dias: number; de: string; ate: string };
  conexoes: { plataforma: string; conectada: boolean }[];
  trafego: {
    periodo_atual: TotaisSimples;
    periodo_anterior: TotaisSimples;
    por_plataforma: (TotaisSimples & { plataforma: string })[];
  };
  campanhas: CampanhaResumo[];
  site: {
    dominio: string;
    dias: number;
    visitantes: number;
    visualizacoes: number;
    cliques_whatsapp: number;
    conversao_whatsapp: number | null;
    origens: { origem: string; visitantes: number; whatsapp: number }[];
    paginas: { pagina: string; visitantes: number; whatsapp: number }[];
  } | null;
  comercial: {
    mes: string;
    faturamento: number;
    vendas: number;
    ticket_medio: number | null;
    roas_real: number | null;
    cac: number | null;
    por_produto: { produto: string; vendas: number; faturamento: number }[];
  };
  metas: { metrica: string; alvo: number; atual: number | null }[];
  limites: {
    orcamento_diario_max_sem_aprovacao: number;
    aumento_max_por_ajuste_percent: number;
    orcamento_mensal_max: number;
    gasto_no_mes: number;
    dias_restantes_no_mes: number;
  };
  /** Regras de prudência que a IA deve seguir (as mesmas que o código confere depois). */
  regras: { dias_minimos_de_dados: number; cliques_minimos: number; conversoes_minimas_para_aumentar: number };
  /** Blocos extras, preenchidos quando os módulos existem (presença no Google, aprendizados...). */
  presenca_google?: unknown;
  aprendizados?: unknown;
  /** O que está faltando, em português, para a IA não tirar conclusão do vazio. */
  avisos: string[];
};
