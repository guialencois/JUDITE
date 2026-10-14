/**
 * Modo "Quero ideias": a CMO mostra as melhores oportunidades do momento, explicadas.
 *
 * Quais ideias existem, o canal, o objetivo, o orçamento e a métrica saem do CÓDIGO (oportunidades.ts
 * e financeiro.ts). A IA só escreve o texto de cada uma (título, público, estratégia, hipótese, por quê),
 * e ideia que a IA inventar fora da lista é descartada. Dependências injetadas, como em gerar.ts.
 */

import { z } from "zod";
import { numerosNaoCadastrados } from "@/lib/criativos/gerar";
import { ErroIA, type RespostaIA } from "@/lib/ia";
import { NOME_PLATAFORMA, type Plataforma } from "@/lib/trafego/tipos";
import { orcamentoInicial } from "./financeiro";
import type { ContextoCMO } from "./gerar";
import { analisarOportunidades, ROTULO_OPORTUNIDADE, type Confianca, type Objetivo, type Oportunidade, type TipoDeOportunidade } from "./oportunidades";

export const MAX_IDEIAS = 3;

export const ideiasIaSchema = z.object({
  ideias: z.array(z.object({
    chave: z.string(),
    titulo: z.string(),
    publico: z.string(),
    estrategia: z.string(),
    hipotese: z.string(),
    por_que: z.string(),
  })),
});

const METRICA_DO_OBJETIVO: Record<Objetivo, string> = {
  mensagens: "Custo por conversa no WhatsApp", trafego: "Custo por clique", conversoes: "Custo por venda", reconhecimento: "Pessoas alcançadas",
};

export type Ideia = {
  produtoId: string;
  produto: string;
  oportunidade: TipoDeOportunidade;
  plataforma: Plataforma;
  objetivo: Objetivo;
  titulo: string;
  orcamentoSugerido: number | null;
  detalhes: {
    rotulo: string; canal: string; publico: string; estrategia: string; hipotese: string; por_que: string;
    metrica: string; confianca: Confianca; dados: string[]; ressalvas: string[]; avisos: string[];
  };
};

export type DependenciasDeIdeias = {
  iaPronta(): boolean;
  motivoSemIa(): string;
  carregarContexto(workspaceId: string): Promise<ContextoCMO>;
  pedirIdeias(sistema: string, usuario: string): Promise<RespostaIA<unknown>>;
  salvar(workspaceId: string, usuarioId: string | null, ideias: Ideia[], modelo: string): Promise<string | null>;
};

export type ResultadoDeIdeias = { ok: true; quantidade: number } | { ok: false; motivo: string };

const SISTEMA = `Você é a JUDITE, Diretora de Marketing (CMO) com IA de uma pequena empresa brasileira. Você recebe uma lista de oportunidades de campanha já escolhidas pela análise dos dados e escreve, em português simples, uma ideia para cada uma.

Regras que você nunca quebra:
1. Escreva UMA ideia para cada oportunidade da lista e copie a "chave" exatamente. Não crie ideia fora da lista.
2. Use SOMENTE os fatos do JSON. Não invente preço, público comprovado, resultado esperado em números nem fatos sobre o produto.
3. "titulo": uma frase curta dizendo a campanha (ex.: "Campanha para quem pesquisa ..."). "publico": quem vai ver. "estrategia": como funciona, em 1 ou 2 frases. "hipotese": uma frase testável. "por_que": por que vale a pena agora, citando os dados da oportunidade.`;

/** Escolhe as oportunidades que viram ideia: as melhores, sem repetir o mesmo produto e canal. */
export function escolherParaIdeias(oportunidades: Oportunidade[]): Oportunidade[] {
  const vistas = new Set<string>();
  const escolhidas: Oportunidade[] = [];
  for (const o of oportunidades) {
    const par = `${o.produto.id}:${o.plataforma}`;
    if (vistas.has(par)) continue;
    vistas.add(par);
    escolhidas.push(o);
    if (escolhidas.length >= MAX_IDEIAS) break;
  }
  return escolhidas;
}

export async function gerarIdeias(deps: DependenciasDeIdeias, workspaceId: string, usuarioId: string | null): Promise<ResultadoDeIdeias> {
  if (!deps.iaPronta()) return { ok: false, motivo: deps.motivoSemIa() };

  let ctx: ContextoCMO;
  try {
    ctx = await deps.carregarContexto(workspaceId);
  } catch {
    return { ok: false, motivo: "Não foi possível ler os dados do workspace. Confira se as migrações foram aplicadas no Supabase." };
  }
  if (!ctx.produtos.length) return { ok: false, motivo: "Cadastre pelo menos um produto no Creative Studio para a JUDITE ter ideias." };

  const escolhidas = escolherParaIdeias(analisarOportunidades({
    produtos: ctx.produtos, campanhas: ctx.campanhas, resumo: ctx.resumo, bloqueadas: ctx.limites.bloqueadas,
  }));
  if (!escolhidas.length) return { ok: false, motivo: "Todas as combinações de produto e canal já têm campanha em andamento, na fila ou recusada há pouco tempo." };

  const usuario = "Escreva as ideias para estas oportunidades (JSON):\n" + JSON.stringify({
    oportunidades: escolhidas.map((o) => ({
      chave: o.chave, tipo: ROTULO_OPORTUNIDADE[o.tipo], canal: NOME_PLATAFORMA[o.plataforma], objetivo: o.objetivo, etapa_funil: o.funil,
      motivo: o.motivo, dados: o.dados, ressalvas: o.ressalvas,
      produto: { nome: o.produto.nome, descricao: o.produto.descricao, preco: o.produto.preco, detalhes: o.produto.detalhes, publico: o.produto.publico },
    })),
  });

  let resposta: RespostaIA<unknown>;
  try {
    resposta = await deps.pedirIdeias(SISTEMA, usuario);
  } catch (erro) {
    return { ok: false, motivo: erro instanceof ErroIA ? erro.message : "Erro inesperado ao falar com a IA." };
  }
  const lido = ideiasIaSchema.safeParse(resposta.dados);
  if (!lido.success) return { ok: false, motivo: "A IA respondeu fora do formato esperado. Tente de novo." };

  const ideias: Ideia[] = [];
  for (const o of escolhidas) {
    // Só vale ideia de oportunidade que está na lista: o que a IA inventar fora dela é ignorado.
    const texto = lido.data.ideias.find((i) => i.chave === o.chave);
    if (!texto || !texto.titulo.trim()) continue;
    const financeiro = orcamentoInicial({ maxSemAprovacao: ctx.limites.maxSemAprovacao, mes: ctx.mes, canal: ctx.canais[o.plataforma] ?? null });
    const estranhos = numerosNaoCadastrados([texto.titulo, texto.publico, texto.estrategia, texto.hipotese, texto.por_que].join(" \n "), usuario + " 18 65 7 14 ");
    ideias.push({
      produtoId: o.produto.id, produto: o.produto.nome, oportunidade: o.tipo, plataforma: o.plataforma, objetivo: o.objetivo,
      titulo: texto.titulo.trim().slice(0, 200),
      orcamentoSugerido: financeiro.recomendado > 0 ? financeiro.recomendado : null,
      detalhes: {
        rotulo: ROTULO_OPORTUNIDADE[o.tipo], canal: NOME_PLATAFORMA[o.plataforma],
        publico: texto.publico.trim().slice(0, 400), estrategia: texto.estrategia.trim().slice(0, 600),
        hipotese: texto.hipotese.trim().slice(0, 400), por_que: texto.por_que.trim().slice(0, 800),
        metrica: METRICA_DO_OBJETIVO[o.objetivo], confianca: o.confianca, dados: o.dados, ressalvas: o.ressalvas,
        avisos: [
          ...(estranhos.length ? [`O texto cita número(s) que não estão nos dados: ${estranhos.slice(0, 5).join(", ")}. Desconsidere-os.`] : []),
          ...(financeiro.recomendado > 0 ? [] : [financeiro.explicacao]),
        ],
      },
    });
  }
  if (!ideias.length) return { ok: false, motivo: "A IA não devolveu ideias para as oportunidades encontradas. Tente de novo." };

  const erro = await deps.salvar(workspaceId, usuarioId, ideias, resposta.modelo);
  return erro ? { ok: false, motivo: erro } : { ok: true, quantidade: ideias.length };
}
