/** Dados de exemplo para os testes do motor da CMO. Não é usado pela aplicação. */

import type { ResumoDiretor } from "@/lib/diretor/tipos";
import type { LimitesDoWorkspace } from "@/lib/trafego/mes";
import type { PlanoIA } from "./agentes";
import type { ContextoCMO } from "./gerar";
import type { ProdutoCMO } from "./oportunidades";

export const produto = (m: Partial<ProdutoCMO> = {}): ProdutoCMO => ({
  id: "11111111-1111-4111-8111-111111111111", nome: "Passeio Lagoa Azul", descricao: "Passeio de 4x4 pelos Lençóis Maranhenses.",
  preco: 120, detalhes: "Duração de 4 horas. Saída de Barreirinhas.", publico: "Casais e famílias em viagem pelo Maranhão",
  link: null, criativosAprovados: 0, ...m,
});

export const resumo = (m: Partial<ResumoDiretor> = {}): ResumoDiretor => ({
  hoje: "2026-10-05",
  janela: { dias: 14, de: "2026-09-21", ate: "2026-10-04" },
  conexoes: [
    { plataforma: "Google Ads", conectada: true }, { plataforma: "Meta Ads", conectada: true }, { plataforma: "TikTok Ads", conectada: false },
  ],
  trafego: {
    periodo_atual: { gasto: 0, impressoes: 0, cliques: 0, compras: 0, receita: 0 },
    periodo_anterior: { gasto: 0, impressoes: 0, cliques: 0, compras: 0, receita: 0 },
    por_plataforma: [],
  },
  campanhas: [],
  site: null,
  comercial: { mes: "2026-10", faturamento: 0, vendas: 0, ticket_medio: null, roas_real: null, cac: null, por_produto: [] },
  metas: [],
  limites: { orcamento_diario_max_sem_aprovacao: 100, aumento_max_por_ajuste_percent: 10, orcamento_mensal_max: 2000, gasto_no_mes: 0, dias_restantes_no_mes: 27 },
  regras: { dias_minimos_de_dados: 7, cliques_minimos: 100, conversoes_minimas_para_aumentar: 5 },
  avisos: [],
  ...m,
});

export const limites = (m: Partial<LimitesDoWorkspace> = {}): LimitesDoWorkspace => ({
  maxSemAprovacao: 100, aumentoMaxPercent: 10, mensalMax: 2000, custosPercent: 25, reducaoMaxPercent: 50,
  mensalPorCanal: { google_ads: 0, facebook: 0, tiktok: 0 }, bloqueadas: [], ...m,
});

export const contexto = (m: Partial<ContextoCMO> = {}): ContextoCMO => ({
  resumo: resumo(), produtos: [produto()], campanhas: [], limites: limites(),
  mes: { gastoNoMes: 0, outrasCampanhasPorDia: 0, diasRestantes: 27, mensalMax: 2000 },
  canais: {}, aprendizados: [], ...m,
});

/** Um plano bem-comportado, como a IA devolveria para o produto de exemplo. */
export const planoDaIA = (m: Partial<PlanoIA> = {}): PlanoIA => ({
  nome: "JUDITE - Lagoa Azul - conversas",
  plataforma: "google_ads", objetivo: "mensagens", orcamento_diario: 30, etapa_funil: "fundo",
  estrategia: "Campanha de busca para quem pesquisa o passeio, levando ao WhatsApp. Acompanhar o custo por conversa nos primeiros 7 dias.",
  palavras_chave: [
    { termo: "passeio lagoa azul", correspondencia: "frase" }, { termo: "Passeio Lagoa Azul", correspondencia: "exata" },
    { termo: "passeio lençóis maranhenses", correspondencia: "frase" },
  ],
  segmentacao: "intencao_de_busca",
  publico: { regiao: "Maranhão", idade_min: 25, idade_max: 55, interesses: "viagens, natureza" },
  anuncios: [
    { formato: "AIDA", titulo: "Passeio Lagoa Azul", descricao: "Passeio de 4x4 saindo de Barreirinhas.", cta: "Chame no WhatsApp", texto: "Conheça a Lagoa Azul. Passeio de 4 horas por R$ 120. Chame no WhatsApp." },
    { formato: "PAS", titulo: "Lagoa Azul de 4x4", descricao: "Saída de Barreirinhas.", cta: "Reserve agora", texto: "Sem tempo para planejar? O passeio dura 4 horas. Fale com a gente." },
  ],
  ideias_de_criativo: ["Vídeo curto do 4x4 chegando na lagoa."],
  teste_ab: { variavel: "título", descricao: "Comparar o título com e sem o nome da cidade." },
  hipotese: "Se anunciarmos para quem pesquisa o passeio, então teremos conversas no WhatsApp.",
  metrica_principal: "custo_por_conversa",
  impacto_esperado: "Mais conversas de pessoas que já querem o passeio.",
  por_que: "Quem pesquisa o passeio já quer comprar. A campanha será criada pausada e depende da sua aprovação.",
  risco: "medio", risco_motivo: "Não há histórico no canal.", confianca: "alta",
  dados_utilizados: ["Meta Ads está conectado à JUDITE."],
  ...m,
});
