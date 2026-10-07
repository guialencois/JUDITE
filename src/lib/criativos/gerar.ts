/**
 * Creative Studio: gera variações de texto de anúncio (título, descrição, CTA, AIDA/PAS) com a IA (src/lib/ia),
 * usando SOMENTE os fatos cadastrados no produto. Depois da IA, o código confere de novo:
 * variação que cita um número (preço, desconto, duração, nota) que não está no cadastro é descartada.
 */

import { z } from "zod";
import { pedirJson } from "@/lib/ia";

export type ProdutoParaTexto = {
  nome: string;
  descricao: string | null;
  preco: number | null;
  detalhes: string | null;
  publico: string | null;
  link: string | null;
};

export const FORMATOS = ["AIDA", "PAS"] as const;
export type Formato = (typeof FORMATOS)[number];

export const variacoesSchema = z.object({
  variacoes: z.array(z.object({
    formato: z.enum(FORMATOS),
    titulo: z.string(),
    descricao: z.string(),
    cta: z.string(),
    texto: z.string(),
  })),
});
export type Variacao = z.infer<typeof variacoesSchema>["variacoes"][number];

/** Limites de tamanho por plataforma (títulos curtos nos anúncios de busca do Google). */
const ORIENTACAO: Record<string, string> = {
  google_ads: "Google Ads (busca): título com no máximo 30 caracteres e descrição com no máximo 90 caracteres.",
  facebook: "Meta Ads (Facebook e Instagram): título com no máximo 40 caracteres e descrição com no máximo 125 caracteres.",
  tiktok: "TikTok Ads: título com no máximo 40 caracteres e descrição com no máximo 100 caracteres, linguagem falada.",
};
export const LIMITES_TITULO: Record<string, number> = { google_ads: 30, facebook: 40, tiktok: 40 };
export const LIMITES_DESCRICAO: Record<string, number> = { google_ads: 90, facebook: 125, tiktok: 100 };

const SISTEMA = `Você é redatora publicitária da JUDITE e escreve textos de anúncio em português do Brasil para pequenas empresas.

Regras que você nunca quebra:
1. Use SOMENTE os fatos que estão no cadastro do produto (JSON). Não invente preço, desconto, promoção, prazo, duração, quantidade de vagas, nota, número de avaliações, prêmios, garantias nem resultados.
2. Só cite preço se o campo "preco" estiver preenchido, e exatamente com esse valor. Nunca escreva outro número que não esteja no cadastro.
3. Nada de urgência falsa ("últimas vagas", "só hoje") nem superlativos que não dá para provar ("o melhor do Brasil").
4. Se o cadastro tiver poucos fatos, escreva textos mais gerais em vez de completar com suposições.

Formatos:
- AIDA: o campo "texto" segue Atenção, Interesse, Desejo e Ação, em 4 frases ou parágrafos curtos.
- PAS: o campo "texto" segue Problema, Agitação e Solução, em 3 partes curtas.
- "titulo" e "descricao" respeitam os limites da plataforma informada. "cta" é uma chamada curta para a ação (até 4 palavras).
- Cada variação deve ter um ângulo diferente (benefício, público, dúvida comum, experiência).`;

/** Texto com todos os fatos do cadastro, usado para conferir os números citados pela IA. */
export function fonteDoProduto(p: ProdutoParaTexto): string {
  const preco = p.preco === null ? "" : [
    p.preco.toFixed(2), p.preco.toFixed(2).replace(".", ","), String(Math.round(p.preco)),
    p.preco.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), p.preco.toLocaleString("pt-BR"),
  ].join(" ");
  return [p.nome, p.descricao, p.detalhes, p.publico, preco].filter(Boolean).join(" \n ");
}

const soDigitos = (s: string) => s.replace(/\D/g, "");

/**
 * Números citados no texto que NÃO aparecem no cadastro do produto.
 * Compara só os dígitos ("1.250,00" e "1250" são o mesmo número); zeros de centavos no fim são ignorados.
 */
export function numerosNaoCadastrados(texto: string, fonte: string): string[] {
  // Tira a pontuação da frase que grudou no número ("150." no fim de uma frase).
  const limpar = (n: string) => n.replace(/[.,]+$/, "");
  const normalizar = (n: string) => soDigitos(limpar(n).replace(/[.,]00$/, ""));
  const conhecidos = new Set((fonte.match(/\d[\d.,]*/g) ?? []).map(normalizar));
  const citados = (texto.match(/\d[\d.,]*/g) ?? []).map(limpar);
  return [...new Set(citados.filter((n) => !conhecidos.has(normalizar(n))))];
}

export type ResultadoVariacoes = { aceitas: Variacao[]; descartadas: { titulo: string; motivo: string }[] };

/** Confere cada variação: campos preenchidos, tamanho e nenhum número fora do cadastro. */
export function conferirVariacoes(variacoes: Variacao[], produto: ProdutoParaTexto, plataforma: string | null): ResultadoVariacoes {
  const fonte = fonteDoProduto(produto);
  const aceitas: Variacao[] = [];
  const descartadas: { titulo: string; motivo: string }[] = [];
  for (const v of variacoes) {
    const tudo = [v.titulo, v.descricao, v.cta, v.texto].join(" \n ");
    const estranhos = numerosNaoCadastrados(tudo, fonte);
    if (!v.titulo.trim() || !v.texto.trim()) {
      descartadas.push({ titulo: v.titulo || "(sem título)", motivo: "veio incompleta" });
    } else if (estranhos.length) {
      descartadas.push({ titulo: v.titulo, motivo: `cita número que não está no cadastro do produto (${estranhos.slice(0, 3).join(", ")})` });
    } else {
      const maxTitulo = plataforma ? LIMITES_TITULO[plataforma] : undefined;
      const maxDescricao = plataforma ? LIMITES_DESCRICAO[plataforma] : undefined;
      if ((maxTitulo && v.titulo.length > maxTitulo) || (maxDescricao && v.descricao.length > maxDescricao)) {
        descartadas.push({ titulo: v.titulo, motivo: "passou do tamanho permitido pela plataforma" });
      } else {
        aceitas.push(v);
      }
    }
  }
  return { aceitas, descartadas };
}

export async function gerarVariacoes(opcoes: {
  produto: ProdutoParaTexto;
  plataforma: string | null;
  quantidade: number;
  orientacao: string | null;
  aprendizados: string[];
}): Promise<ResultadoVariacoes> {
  const pedido = {
    produto: opcoes.produto,
    plataforma: opcoes.plataforma ? ORIENTACAO[opcoes.plataforma] : "Sem plataforma definida: título com até 40 caracteres e descrição com até 125.",
    quantidade_de_variacoes: opcoes.quantidade,
    formatos: "Metade AIDA e metade PAS.",
    orientacao_do_dono: opcoes.orientacao || null,
    aprendizados_anteriores: opcoes.aprendizados,
  };
  const resposta = await pedirJson({
    schema: variacoesSchema,
    sistema: SISTEMA,
    usuario: "Escreva as variações para este pedido (JSON):\n" + JSON.stringify(pedido),
    maxTokens: 8000,
  });
  const validada = variacoesSchema.parse(resposta.dados);
  return conferirVariacoes(validada.variacoes.slice(0, 8), opcoes.produto, opcoes.plataforma);
}
