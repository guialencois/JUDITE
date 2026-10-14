/**
 * Etapa de CONFERÊNCIA: o plano que a IA devolveu passa por regras de código antes de ir para a fila.
 * A IA propõe; o código decide o que vale:
 *   - plataforma bloqueada ou produto trocado → o plano é recusado;
 *   - o que a pessoa pediu (plataforma, objetivo, orçamento) vence o que a IA escolheu;
 *   - o orçamento nunca passa do teto do Agente Financeiro;
 *   - anúncio que cita número fora do cadastro do produto é descartado;
 *   - a confiança nunca fica acima da calculada pela análise dos dados.
 * Funções puras (testes em plano.test.ts).
 */

import { conferirVariacoes, numerosNaoCadastrados, type ProdutoParaTexto } from "@/lib/criativos/gerar";
import { rascunhoSchema, type Rascunho } from "@/lib/campanhas/rascunho";
import { NOME_PLATAFORMA, type Plataforma } from "@/lib/trafego/tipos";
import type { PlanoIA } from "./agentes";
import { orcamentoInvalido, type Orcamento } from "./financeiro";
import { ROTULO_OPORTUNIDADE, type Confianca, type Objetivo, type Oportunidade } from "./oportunidades";

export type ModoDeCriacao = "diario" | "automatico" | "guiado" | "ideia";
export const ROTULO_MODO: Record<ModoDeCriacao, string> = {
  diario: "proposta automática do dia", automatico: "criada automaticamente a seu pedido", guiado: "criada com as suas respostas", ideia: "criada a partir de uma ideia",
};

export const ROTULO_METRICA: Record<PlanoIA["metrica_principal"], string> = {
  cliques: "Cliques", custo_por_clique: "Custo por clique", conversas_no_whatsapp: "Conversas no WhatsApp",
  custo_por_conversa: "Custo por conversa", vendas: "Vendas", custo_por_venda: "Custo por venda", alcance: "Pessoas alcançadas",
};

/** O que fica gravado em campanha_rascunhos.plano: a resposta para "por que você recomendou esta campanha?". */
export type PlanoFinal = {
  versao: 1;
  modo: ModoDeCriacao;
  oportunidade: { chave: string; tipo: string; rotulo: string; motivo: string; dados: string[]; ressalvas: string[]; pontos: number };
  alternativas: { rotulo: string; produto: string; plataforma: string; motivo: string }[];
  etapa_funil: PlanoIA["etapa_funil"];
  segmentacao: PlanoIA["segmentacao"];
  estrategia: string;
  hipotese: string;
  metrica_principal: PlanoIA["metrica_principal"];
  impacto_esperado: string;
  risco: PlanoIA["risco"];
  risco_motivo: string;
  confianca: Confianca;
  dados_utilizados: string[];
  por_que: string;
  palavras_chave: PlanoIA["palavras_chave"];
  anuncios: PlanoIA["anuncios"];
  anuncios_descartados: { titulo: string; motivo: string }[];
  ideias_de_criativo: string[];
  teste_ab: PlanoIA["teste_ab"];
  financeiro: Orcamento;
  /** O que o código mudou ou estranhou na resposta da IA. Aparece na tela: nada é escondido. */
  avisos: string[];
  modelo: string;
  gerado_em: string;
};

export type EntradaConferencia = {
  modo: ModoDeCriacao;
  oportunidade: Oportunidade;
  alternativas: Oportunidade[];
  financeiro: Orcamento;
  bloqueadas: Plataforma[];
  /** Escolhas explícitas da pessoa: vencem a IA. */
  pedido: { plataforma?: Plataforma | null; objetivo?: Objetivo | null; orcamento?: number | null };
  /** Texto do JSON enviado à IA: é a única fonte aceita para os números citados. */
  fonte: string;
  modelo: string;
  agora?: Date;
};

export type ResultadoConferencia =
  | { ok: true; rascunho: Rascunho; plano: PlanoFinal }
  | { ok: false; erro: string };

const ORDEM: Record<Confianca, number> = { baixa: 0, media: 1, alta: 2 };
const cortar = (s: string, n: number) => s.trim().slice(0, n);
const reais = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");
/** Números que as próprias instruções mencionam (idades, dias de aprendizado): não contam como inventados. */
const NUMEROS_DAS_REGRAS = " 7 14 18 65 ";

export function conferirPlano(ia: PlanoIA, e: EntradaConferencia): ResultadoConferencia {
  const avisos: string[] = [];
  const op = e.oportunidade;

  const plataforma = e.pedido.plataforma ?? op.plataforma;
  if (ia.plataforma !== plataforma) avisos.push(`A IA sugeriu ${NOME_PLATAFORMA[ia.plataforma]}; foi mantido ${NOME_PLATAFORMA[plataforma]}, que é o canal da oportunidade escolhida.`);
  if (e.bloqueadas.includes(plataforma)) return { ok: false, erro: `${NOME_PLATAFORMA[plataforma]} está bloqueado nos Limites da IA.` };

  const objetivo = e.pedido.objetivo ?? op.objetivo;

  // Orçamento: o pedido da pessoa vence; senão vale o da IA, limitado pelo teto do Agente Financeiro.
  let orcamento: number;
  if (e.pedido.orcamento !== null && e.pedido.orcamento !== undefined) {
    const invalido = orcamentoInvalido(e.pedido.orcamento);
    if (invalido) return { ok: false, erro: invalido };
    orcamento = Math.round(e.pedido.orcamento * 100) / 100;
    if (orcamento > e.financeiro.teto) avisos.push(`O orçamento que você pediu (${reais(orcamento)} por dia) passa do teto calculado de ${reais(e.financeiro.teto)}. ${e.financeiro.explicacao}`);
  } else {
    if (e.financeiro.recomendado <= 0) return { ok: false, erro: e.financeiro.explicacao };
    const invalido = orcamentoInvalido(ia.orcamento_diario);
    if (invalido) {
      orcamento = e.financeiro.recomendado;
      avisos.push(`A IA devolveu um orçamento inválido; foi usado o recomendado de ${reais(orcamento)} por dia.`);
    } else if (ia.orcamento_diario > e.financeiro.teto) {
      orcamento = e.financeiro.teto;
      avisos.push(`A IA propôs ${reais(ia.orcamento_diario)} por dia; foi reduzido para o teto de ${reais(orcamento)}.`);
    } else {
      orcamento = Math.round(ia.orcamento_diario * 100) / 100;
    }
  }

  // Anúncios: só os que usam fatos do cadastro e cabem no tamanho da plataforma.
  const produto: ProdutoParaTexto = {
    nome: op.produto.nome, descricao: op.produto.descricao, preco: op.produto.preco, detalhes: op.produto.detalhes,
    publico: op.produto.publico, link: op.produto.link,
  };
  const { aceitas, descartadas } = conferirVariacoes(ia.anuncios.slice(0, 6), produto, plataforma);
  if (!aceitas.length) avisos.push("Nenhum anúncio escrito pela IA passou na conferência; escreva os anúncios no Creative Studio antes de ativar.");

  // Números citados nos textos de estratégia precisam existir nos dados enviados.
  const textos = [ia.por_que, ia.estrategia, ia.hipotese, ia.impacto_esperado, ia.risco_motivo, ...ia.dados_utilizados].join(" \n ");
  const estranhos = numerosNaoCadastrados(textos, e.fonte + NUMEROS_DAS_REGRAS + orcamento + " " + orcamento.toFixed(2));
  if (estranhos.length) avisos.push(`A explicação da IA cita número(s) que não estão nos dados: ${estranhos.slice(0, 5).join(", ")}. Desconsidere-os.`);

  const confianca: Confianca = ORDEM[ia.confianca] > ORDEM[op.confianca] ? op.confianca : ia.confianca;
  if (confianca !== ia.confianca) avisos.push(`A IA declarou confiança ${ia.confianca}; pelos dados disponíveis ela é ${confianca}.`);

  const idade = (n: number | null) => (n === null ? null : Math.min(65, Math.max(18, Math.round(n))));
  let idadeMin = idade(ia.publico.idade_min);
  let idadeMax = idade(ia.publico.idade_max);
  if (idadeMin !== null && idadeMax !== null && idadeMin > idadeMax) [idadeMin, idadeMax] = [idadeMax, idadeMin];

  const nome = cortar(ia.nome, 140);
  const rascunho = rascunhoSchema.safeParse({
    plataforma, objetivo,
    nome: (nome.startsWith("JUDITE") ? nome : `JUDITE - ${nome || op.produto.nome}`).slice(0, 150),
    orcamento_diario: orcamento,
    publico: { regiao: cortar(ia.publico.regiao, 200), idade_min: idadeMin, idade_max: idadeMax, interesses: cortar(ia.publico.interesses, 500) },
    produto_id: op.produto.id,
    criativo_ids: [],
    justificativa: cortar(ia.por_que, 2000),
  });
  if (!rascunho.success) return { ok: false, erro: "A IA devolveu um plano fora das regras (nome, orçamento ou público inválido)." };

  const palavras = plataforma === "google_ads"
    ? [...new Map(ia.palavras_chave.map((p) => [p.termo.trim().toLowerCase(), { termo: cortar(p.termo, 80), correspondencia: p.correspondencia }])).values()]
      .filter((p) => p.termo).slice(0, 20)
    : [];

  const plano: PlanoFinal = {
    versao: 1,
    modo: e.modo,
    oportunidade: { chave: op.chave, tipo: op.tipo, rotulo: ROTULO_OPORTUNIDADE[op.tipo], motivo: op.motivo, dados: op.dados, ressalvas: op.ressalvas, pontos: op.pontos },
    alternativas: e.alternativas.slice(0, 4).map((a) => ({
      rotulo: ROTULO_OPORTUNIDADE[a.tipo], produto: a.produto.nome, plataforma: NOME_PLATAFORMA[a.plataforma], motivo: a.motivo,
    })),
    etapa_funil: op.funil,
    segmentacao: ia.segmentacao,
    estrategia: cortar(ia.estrategia, 1500),
    hipotese: cortar(ia.hipotese, 500),
    metrica_principal: ia.metrica_principal,
    impacto_esperado: cortar(ia.impacto_esperado, 800),
    risco: ia.risco,
    risco_motivo: cortar(ia.risco_motivo, 500),
    confianca,
    dados_utilizados: [...new Set([...op.dados, ...ia.dados_utilizados.map((d) => cortar(d, 300))])].filter(Boolean).slice(0, 10),
    por_que: cortar(ia.por_que, 2000),
    palavras_chave: palavras,
    anuncios: aceitas.slice(0, 4),
    anuncios_descartados: descartadas,
    ideias_de_criativo: ia.ideias_de_criativo.map((i) => cortar(i, 300)).filter(Boolean).slice(0, 5),
    teste_ab: { variavel: cortar(ia.teste_ab.variavel, 120), descricao: cortar(ia.teste_ab.descricao, 500) },
    financeiro: e.financeiro,
    avisos,
    modelo: e.modelo,
    gerado_em: (e.agora ?? new Date()).toISOString(),
  };
  return { ok: true, rascunho: rascunho.data, plano };
}
