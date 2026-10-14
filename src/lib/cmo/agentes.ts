/**
 * Arquitetura de agentes da CMO.
 *
 * Cada especialista é dono de uma parte do plano de campanha: tem as próprias instruções e o próprio
 * pedaço do schema. A CMO (coordenadora) junta as partes num plano só.
 *
 * Hoje a CMO consulta todos os especialistas de IA em UM pedido (modo "conjunto"): cabe na cota grátis
 * e mantém o plano coerente. Como cada agente já tem instruções e campos separados, passar um deles
 * para um pedido próprio (ou para outro modelo) é trocar o modo, sem mexer no resto.
 *
 * Dois agentes não usam IA de propósito: o de Mercado/Analytics (oportunidades.ts) e o Financeiro
 * (financeiro.ts) decidem com regras fixas sobre dados reais, e entregam o resultado pronto para os outros.
 */

import { z } from "zod";

const curto = z.string();

/** Campos de cada especialista de IA. O plano é a união de todos. */
const CAMPOS = {
  trafego: {
    nome: curto,
    plataforma: z.enum(["google_ads", "facebook", "tiktok"]),
    objetivo: z.enum(["trafego", "mensagens", "conversoes", "reconhecimento"]),
    orcamento_diario: z.number(),
    etapa_funil: z.enum(["topo", "meio", "fundo"]),
    estrategia: curto,
    palavras_chave: z.array(z.object({ termo: curto, correspondencia: z.enum(["ampla", "frase", "exata"]) })),
  },
  audiencia: {
    segmentacao: z.enum(["intencao_de_busca", "interesses", "remarketing", "publico_semelhante"]),
    publico: z.object({ regiao: curto, idade_min: z.number().nullable(), idade_max: z.number().nullable(), interesses: curto }),
  },
  copy: {
    anuncios: z.array(z.object({ formato: z.enum(["AIDA", "PAS"]), titulo: curto, descricao: curto, cta: curto, texto: curto })),
  },
  criativo: {
    ideias_de_criativo: z.array(curto),
    teste_ab: z.object({ variavel: curto, descricao: curto }),
  },
  analytics: {
    hipotese: curto,
    metrica_principal: z.enum(["cliques", "custo_por_clique", "conversas_no_whatsapp", "custo_por_conversa", "vendas", "custo_por_venda", "alcance"]),
    impacto_esperado: curto,
  },
  cmo: {
    por_que: curto,
    risco: z.enum(["baixo", "medio", "alto"]),
    risco_motivo: curto,
    confianca: z.enum(["baixa", "media", "alta"]),
    dados_utilizados: z.array(curto),
  },
} as const;

export type IdDoAgente = "cmo" | "mercado" | "trafego" | "copy" | "criativo" | "audiencia" | "analytics" | "seo_aeo" | "financeiro";

export type Agente = {
  id: IdDoAgente;
  nome: string;
  papel: string;
  /** "ia" escreve parte do plano; "regras" decide com código; "futuro" ainda não participa das campanhas pagas. */
  tipo: "ia" | "regras" | "futuro";
  instrucoes?: string;
};

export const AGENTES: Agente[] = [
  {
    id: "cmo", nome: "CMO", tipo: "ia", papel: "Coordena os especialistas, fecha o plano e explica a decisão.",
    instrucoes: `Você fecha o plano e responde "por que esta campanha?" no campo "por_que": 2 a 4 frases em português simples, citando só números que estão no JSON. Diga que a campanha será criada pausada e depende de aprovação. "risco" e "risco_motivo": o que pode dar errado com este dinheiro. "confianca": nunca acima de oportunidade.confianca. "dados_utilizados": de 2 a 6 itens copiados ou resumidos de oportunidade.dados e do resumo do negócio; nada inventado.`,
  },
  { id: "mercado", nome: "Agente de Mercado", tipo: "regras", papel: "Encontra e ordena as oportunidades com os dados reais (produtos, campanhas, site, vendas)." },
  {
    id: "trafego", nome: "Agente de Tráfego", tipo: "ia", papel: "Planeja a mídia paga: canal, objetivo, funil, estrutura e palavras-chave.",
    instrucoes: `Use a plataforma, o objetivo e a etapa de funil da oportunidade, a menos que "pedido" traga outra escolha da pessoa. "nome": curto, começando por "JUDITE - ". "estrategia": 2 a 3 frases dizendo como a campanha vai funcionar (tipo de campanha, lance pensado para o objetivo, o que acompanhar nos primeiros 7 dias de aprendizado). "orcamento_diario": use financeiro.recomendado; nunca passe de financeiro.teto. "palavras_chave": só quando a plataforma for google_ads, de 5 a 12 termos de intenção de compra ligados ao produto e à região, cada um com a correspondência adequada (exata para termos de marca/produto, frase para intenção, ampla só se fizer sentido); nas outras plataformas devolva lista vazia.`,
  },
  {
    id: "audiencia", nome: "Agente de Audiência", tipo: "ia", papel: "Define o público e a segmentação.",
    instrucoes: `"segmentacao" segue oportunidade.segmentacao. "publico": região, faixa de idade (entre 18 e 65, ou null) e interesses coerentes com o campo "publico" do produto e com o pedido da pessoa. Sem informação, deixe genérico e diga isso em "por_que". Não invente dado demográfico.`,
  },
  {
    id: "copy", nome: "Agente de Copy", tipo: "ia", papel: "Escreve os anúncios (AIDA e PAS).",
    instrucoes: `"anuncios": de 3 a 4 variações, metade AIDA e metade PAS, cada uma com um ângulo diferente. Respeite limites_de_texto. Use SOMENTE os fatos do cadastro do produto: não invente preço, desconto, prazo, duração, vagas, nota, avaliações nem garantias. Só cite preço se "preco" estiver preenchido, exatamente com esse valor. Nada de urgência falsa nem superlativo que não dá para provar.`,
  },
  {
    id: "criativo", nome: "Agente Criativo", tipo: "ia", papel: "Planeja imagens, vídeos e o primeiro teste A/B.",
    instrucoes: `"ideias_de_criativo": de 2 a 4 ideias de imagem ou vídeo que a pessoa consegue produzir (o que mostrar, em uma frase cada). "teste_ab": UMA variável para testar primeiro (ex.: título, imagem, público) e como comparar.`,
  },
  {
    id: "analytics", nome: "Agente de Analytics", tipo: "ia", papel: "Define a hipótese, a métrica principal e o que esperar.",
    instrucoes: `"hipotese": uma frase testável ("Se..., então..."). "metrica_principal": a que decide se a campanha deu certo para o objetivo. "impacto_esperado": o que deve acontecer se a hipótese estiver certa, em palavras; NÃO prometa números de resultado (cliques, vendas, ROAS) que não estejam no JSON.`,
  },
  { id: "financeiro", nome: "Agente Financeiro", tipo: "regras", papel: "Calcula o orçamento recomendado e o teto com os Limites da IA e o gasto do mês." },
  { id: "seo_aeo", nome: "Agente SEO/AEO", tipo: "futuro", papel: "Planeja conteúdo orgânico. Hoje atua nas recomendações da página Diretor, não nas campanhas pagas." },
];

export const planoIaSchema = z.object({
  ...CAMPOS.trafego, ...CAMPOS.audiencia, ...CAMPOS.copy, ...CAMPOS.criativo, ...CAMPOS.analytics, ...CAMPOS.cmo,
});
export type PlanoIA = z.infer<typeof planoIaSchema>;

/** Instruções da CMO para o pedido único: a base + a parte de cada especialista de IA. */
export function instrucoesDaCMO(): string {
  const partes = AGENTES.filter((a) => a.tipo === "ia" && a.instrucoes).map((a) => `## ${a.nome}\n${a.instrucoes}`);
  return `Você é a JUDITE, Diretora de Marketing (CMO) com IA de uma pequena empresa brasileira. Você coordena especialistas e entrega UM plano de campanha de anúncios, em português do Brasil.

Regras que valem para todos e que você nunca quebra:
1. Use SOMENTE os dados do JSON recebido (produto, oportunidade, resumo do negócio, financeiro, pedido). Não invente preços, resultados, públicos comprovados nem fatos sobre o produto.
2. A oportunidade já foi escolhida pela análise dos dados. Não troque de produto.
3. Escolha a técnica adequada ao objetivo; não use um termo só porque parece sofisticado.
4. Com poucos dados, diga isso com clareza em vez de completar com suposições.

${partes.join("\n\n")}`;
}
