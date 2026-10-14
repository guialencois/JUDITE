/**
 * Etapa de ANÁLISE e DECISÃO da CMO: quais oportunidades de campanha existem hoje e qual vale mais.
 *
 * É código, não IA: as regras são fixas, testadas e explicáveis. Cada oportunidade carrega o motivo,
 * os dados em que se apoiou e a confiança. A IA só entra depois, para escrever o plano da oportunidade escolhida.
 * Funções puras (testes em oportunidades.test.ts).
 */

import type { ResumoDiretor } from "@/lib/diretor/tipos";
import { NOME_PLATAFORMA, type Plataforma } from "@/lib/trafego/tipos";
import { EM_ANDAMENTO, type Estado } from "./estados";

export const TIPOS_DE_OPORTUNIDADE = ["intencao_de_busca", "remarketing", "geracao_de_demanda", "alcance_local"] as const;
export type TipoDeOportunidade = (typeof TIPOS_DE_OPORTUNIDADE)[number];
export type Confianca = "baixa" | "media" | "alta";
export type Objetivo = "trafego" | "mensagens" | "conversoes" | "reconhecimento";

export const ROTULO_OPORTUNIDADE: Record<TipoDeOportunidade, string> = {
  intencao_de_busca: "Capturar quem já está procurando",
  remarketing: "Trazer de volta quem visitou o site",
  geracao_de_demanda: "Gerar interesse em quem ainda não conhece",
  alcance_local: "Alcançar quem está na região",
};

/** O que cada tipo significa em termos de mídia: funil, segmentação e por que existe. */
const MODELO: Record<TipoDeOportunidade, { funil: "topo" | "meio" | "fundo"; segmentacao: string; objetivo: Objetivo; plataformas: Plataforma[]; base: number }> = {
  intencao_de_busca: { funil: "fundo", segmentacao: "intencao_de_busca", objetivo: "mensagens", plataformas: ["google_ads"], base: 60 },
  remarketing: { funil: "fundo", segmentacao: "remarketing", objetivo: "mensagens", plataformas: ["facebook", "google_ads"], base: 55 },
  geracao_de_demanda: { funil: "meio", segmentacao: "interesses", objetivo: "mensagens", plataformas: ["facebook", "tiktok"], base: 40 },
  alcance_local: { funil: "topo", segmentacao: "interesses", objetivo: "reconhecimento", plataformas: ["facebook", "tiktok"], base: 25 },
};

/** Visitantes mínimos em 7 dias para um público de remarketing fazer sentido. */
export const VISITANTES_MINIMOS_REMARKETING = 100;
/** Depois de uma recusa, espera estes dias antes de propor a mesma combinação de novo. */
export const DIAS_APOS_RECUSA = 14;
/** No máximo estas propostas da JUDITE esperando avaliação ao mesmo tempo. */
export const MAX_PROPOSTAS_PENDENTES = 2;

export type ProdutoCMO = {
  id: string; nome: string; descricao: string | null; preco: number | null; detalhes: string | null;
  publico: string | null; link: string | null; criativosAprovados: number;
};
export type CampanhaExistente = {
  produto_id: string | null; plataforma: string; status: string; origem: string; criado_em: string; oportunidade: string | null;
};

export type Oportunidade = {
  /** Chave estável: "<tipo>:<produto>:<plataforma>". */
  chave: string;
  tipo: TipoDeOportunidade;
  produto: ProdutoCMO;
  plataforma: Plataforma;
  objetivo: Objetivo;
  funil: "topo" | "meio" | "fundo";
  segmentacao: string;
  pontos: number;
  confianca: Confianca;
  /** Por que essa oportunidade existe, em português simples. */
  motivo: string;
  /** Os dados reais em que a decisão se apoiou. */
  dados: string[];
  /** O que falta para a confiança subir. */
  ressalvas: string[];
};

export type EntradaAnalise = {
  produtos: ProdutoCMO[];
  campanhas: CampanhaExistente[];
  resumo: ResumoDiretor;
  /** Canais bloqueados nos Limites da IA. */
  bloqueadas: Plataforma[];
  /** Restrições vindas do pedido da pessoa (modo guiado). */
  filtro?: { produtoId?: string | null; plataforma?: Plataforma | null; objetivo?: Objetivo | null; tipo?: TipoDeOportunidade | null };
  agora?: Date;
};

const ocupa = (c: CampanhaExistente) => (EM_ANDAMENTO as readonly string[]).includes(c.status as Estado);

/** Uma campanha igual já existe, está na fila ou foi recusada há pouco? Devolve o motivo, ou null. */
export function motivoDaDuplicidade(
  campanhas: CampanhaExistente[], produtoId: string, plataforma: Plataforma, tipo: TipoDeOportunidade, agora = new Date(),
): string | null {
  const limite = agora.getTime() - DIAS_APOS_RECUSA * 864e5;
  for (const c of campanhas) {
    if (c.produto_id !== produtoId) continue;
    const mesmaIdeia = c.oportunidade ? c.oportunidade === tipo && c.plataforma === plataforma : c.plataforma === plataforma;
    if (!mesmaIdeia) continue;
    if (ocupa(c)) return `já existe uma campanha deste produto em ${NOME_PLATAFORMA[plataforma]} em andamento ou na fila`;
    if (c.status === "recusada" && new Date(c.criado_em).getTime() >= limite) {
      return `você recusou uma proposta igual há menos de ${DIAS_APOS_RECUSA} dias`;
    }
  }
  return null;
}

const conectada = (resumo: ResumoDiretor, p: Plataforma) => resumo.conexoes.some((c) => c.plataforma === NOME_PLATAFORMA[p] && c.conectada);

/** Lista as oportunidades válidas, da melhor para a pior. */
export function analisarOportunidades(e: EntradaAnalise): Oportunidade[] {
  const agora = e.agora ?? new Date();
  const site = e.resumo.site;
  const lista: Oportunidade[] = [];

  for (const produto of e.produtos) {
    if (e.filtro?.produtoId && e.filtro.produtoId !== produto.id) continue;
    const vendas = e.resumo.comercial.por_produto.find((v) => v.produto.trim().toLowerCase() === produto.nome.trim().toLowerCase());

    for (const tipo of TIPOS_DE_OPORTUNIDADE) {
      const modelo = MODELO[tipo];
      if (e.filtro?.tipo && e.filtro.tipo !== tipo) continue;
      if (tipo === "remarketing" && !(site && site.visitantes >= VISITANTES_MINIMOS_REMARKETING)) continue;

      for (const plataforma of modelo.plataformas) {
        if (e.bloqueadas.includes(plataforma)) continue;
        if (e.filtro?.plataforma && e.filtro.plataforma !== plataforma) continue;
        if (motivoDaDuplicidade(e.campanhas, produto.id, plataforma, tipo, agora)) continue;

        const dados: string[] = [];
        const ressalvas: string[] = [];
        let pontos = modelo.base;
        let sinais = 0;

        const historico = e.resumo.trafego.por_plataforma.find((p) => p.plataforma === plataforma);
        if (conectada(e.resumo, plataforma)) {
          pontos += 15;
          dados.push(`${NOME_PLATAFORMA[plataforma]} está conectado à JUDITE.`);
        } else {
          pontos -= 10;
          ressalvas.push(`${NOME_PLATAFORMA[plataforma]} ainda não está conectado em Conexões.`);
        }
        if (historico && historico.compras > 0) {
          pontos += 15; sinais += 1;
          dados.push(`${NOME_PLATAFORMA[plataforma]} registrou ${historico.compras} conversões nos últimos ${e.resumo.janela.dias} dias.`);
        } else if (historico && historico.cliques > 0) {
          pontos += 5;
          dados.push(`${NOME_PLATAFORMA[plataforma]} teve ${historico.cliques} cliques nos últimos ${e.resumo.janela.dias} dias, sem conversões medidas.`);
        } else {
          ressalvas.push(`Não há histórico de campanhas em ${NOME_PLATAFORMA[plataforma]}.`);
        }
        if (vendas) {
          pontos += 10; sinais += 1;
          dados.push(`${vendas.vendas} venda(s) deste produto registradas no mês.`);
        }
        if (site && site.visitantes > 0) {
          sinais += site.cliques_whatsapp > 0 ? 1 : 0;
          dados.push(`O site recebeu ${site.visitantes} visitantes e ${site.cliques_whatsapp} cliques no WhatsApp em ${site.dias} dias.`);
          if (tipo === "remarketing") pontos += Math.min(15, Math.floor(site.visitantes / 100) * 3);
        } else {
          ressalvas.push("Não há visitas medidas no site: a conversão fora das plataformas não pode ser acompanhada.");
        }
        if (produto.criativosAprovados > 0) {
          pontos += 5;
          dados.push(`${produto.criativosAprovados} texto(s) de anúncio aprovados para este produto no Creative Studio.`);
        }
        if (!produto.preco) ressalvas.push("O produto não tem preço cadastrado: os anúncios não vão citar valor.");
        if (!produto.detalhes && !produto.descricao) {
          pontos -= 10;
          ressalvas.push("O cadastro do produto tem poucos fatos; os textos ficarão genéricos.");
        }
        if (e.filtro?.objetivo && e.filtro.objetivo === modelo.objetivo) pontos += 5;

        lista.push({
          chave: `${tipo}:${produto.id}:${plataforma}`,
          tipo, produto, plataforma,
          objetivo: e.filtro?.objetivo ?? modelo.objetivo,
          funil: modelo.funil,
          segmentacao: modelo.segmentacao,
          pontos,
          confianca: sinais >= 2 ? "alta" : sinais === 1 ? "media" : "baixa",
          motivo: motivoDe(tipo, produto.nome, plataforma),
          dados, ressalvas,
        });
      }
    }
  }
  return lista.sort((a, b) => b.pontos - a.pontos || a.produto.nome.localeCompare(b.produto.nome, "pt-BR") || a.chave.localeCompare(b.chave));
}

function motivoDe(tipo: TipoDeOportunidade, produto: string, plataforma: Plataforma): string {
  const onde = NOME_PLATAFORMA[plataforma];
  if (tipo === "intencao_de_busca") return `Quem pesquisa por "${produto}" já quer comprar. Anúncio de busca no ${onde} aparece nesse momento (fundo de funil).`;
  if (tipo === "remarketing") return `O site já recebe visitas. Mostrar "${produto}" de novo, no ${onde}, para quem visitou e não chamou costuma custar menos que buscar gente nova.`;
  if (tipo === "geracao_de_demanda") return `Apresentar "${produto}" no ${onde} para pessoas com interesses parecidos com os dos clientes, para gerar conversas (meio de funil).`;
  return `Tornar "${produto}" conhecido no ${onde} entre pessoas da região, antes de elas começarem a pesquisar (topo de funil).`;
}

export type Decisao = { oportunidade: Oportunidade; alternativas: Oportunidade[] } | { oportunidade: null; motivo: string };

/**
 * DECISÃO: escolhe uma oportunidade para virar proposta. Devolve o motivo quando não há o que propor.
 * "respeitarFila" vale para o ciclo automático; quando uma pessoa pede, a fila cheia não impede.
 */
export function decidirOportunidade(e: EntradaAnalise, opcoes: { respeitarFila: boolean }): Decisao {
  if (!e.produtos.length) return { oportunidade: null, motivo: "Cadastre pelo menos um produto no Creative Studio para a JUDITE propor campanhas." };
  if (e.filtro?.produtoId && !e.produtos.some((p) => p.id === e.filtro?.produtoId)) {
    return { oportunidade: null, motivo: "O produto escolhido não existe ou está inativo." };
  }
  if (opcoes.respeitarFila) {
    const pendentes = e.campanhas.filter((c) => c.origem === "diretor" && c.status === "aguardando_aprovacao").length;
    if (pendentes >= MAX_PROPOSTAS_PENDENTES) {
      return { oportunidade: null, motivo: `Já há ${pendentes} propostas da JUDITE aguardando a sua avaliação. Aprove ou recuse antes de ela propor outra.` };
    }
  }
  const [melhor, ...resto] = analisarOportunidades(e);
  if (!melhor) {
    const bloqueio = e.filtro?.plataforma && e.bloqueadas.includes(e.filtro.plataforma)
      ? `${NOME_PLATAFORMA[e.filtro.plataforma]} está bloqueado nos Limites da IA.`
      : "Todas as combinações de produto e canal já têm campanha em andamento, na fila ou recusada há pouco tempo.";
    return { oportunidade: null, motivo: bloqueio + " Nada novo a propor agora." };
  }
  return { oportunidade: melhor, alternativas: resto.slice(0, 4) };
}
