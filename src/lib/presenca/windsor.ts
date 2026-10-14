/**
 * Presença no Google lida pela Windsor.ai (conectores google_my_business e searchconsole), como
 * alternativa à conexão própria do Google. SÓ LEITURA: responder avaliação e publicar post continuam
 * pela conexão própria, depois da aprovação do dono.
 *
 * Nomes de campos conferidos em 07/10/2026 em https://connectors.windsor.ai/{conector}/fields
 * As funções devolvem os mesmos formatos de src/lib/presenca/google.ts, para a tela e o Diretor não mudarem.
 * SOMENTE no servidor.
 */

import { numero, texto } from "@/lib/anuncios/http";
import { lerWindsor, type LinhaWindsor } from "@/lib/windsor/api";
import type { Avaliacao, Avaliacoes, DesempenhoPerfil, LinhaBusca, LocalPerfil } from "./google";

/** A página lê ao vivo e tem 60s no total: cada consulta espera no máximo isto. */
const TEMPO_LIMITE_MS = 25_000;

export type AcessoWindsor = { chave: string; local: string | null; siteGsc: string | null };

const ESTRELAS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const lista = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const j: unknown = JSON.parse(v);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** Perfil a partir de uma linha do conector google_my_business. Exportada para os testes. */
export function perfilDaWindsor(linha: LinhaWindsor, local: string): LocalPerfil {
  const linhasDoEndereco = lista(linha.location_address_lines).map(texto);
  return {
    conta: "",
    local,
    titulo: texto(linha.location_title),
    endereco: [...linhasDoEndereco, texto(linha.location_address_locality), texto(linha.location_address_administrative_area)].filter(Boolean).join(", "),
    site: texto(linha.location_website_uri) || null,
    telefone: texto(linha.location_primary_phone) || null,
    categoria: texto(linha.location_primary_category_name) || null,
    descricao: texto(linha.location_profile_description) || null,
    temHorario: lista(linha.location_regular_hours_periods).length > 0,
  };
}

/** Avaliações a partir das linhas da tabela Reviews. Exportada para os testes. */
export function avaliacoesDaWindsor(linhas: LinhaWindsor[], totais: LinhaWindsor | undefined): Avaliacoes {
  const vistas = new Map<string, Avaliacao>();
  for (const l of linhas) {
    const id = texto(l.review_id);
    if (!id) continue;
    const bruto = texto(l.review_star_rating).toUpperCase();
    const estrelas = ESTRELAS[bruto] ?? numero(bruto);
    vistas.set(id, {
      // Não é o nome do recurso do Google: por isso a resposta a avaliações lidas pela Windsor fica desligada na tela.
      nome: `windsor:${id}`,
      autor: texto(l.review_reviewer) || "Cliente",
      estrelas: estrelas !== null && estrelas >= 1 && estrelas <= 5 ? Math.round(estrelas) : null,
      comentario: texto(l.review_comment) || null,
      criadaEm: texto(l.review_create_time) || null,
      resposta: texto(l.review_reply_comment) || null,
    });
  }
  const ordenadas = [...vistas.values()].sort((a, b) => (b.criadaEm ?? "").localeCompare(a.criadaEm ?? "")).slice(0, 50);
  return { media: numero(totais?.review_average_rating_total), total: numero(totais?.review_total_count), lista: ordenadas };
}

/** Soma as linhas diárias de desempenho. Exportada para os testes. */
export function desempenhoDaWindsor(linhas: LinhaWindsor[], dias: number): DesempenhoPerfil {
  const soma = (campo: string) => linhas.reduce((s, l) => s + (numero(l[campo]) ?? 0), 0);
  return { dias, visualizacoes: soma("impressions"), cliquesNoSite: soma("website_clicks"), ligacoes: soma("call_clicks"), rotas: soma("direction_requests") };
}

/** Linhas do Search Console. O CTR é recalculado (cliques ÷ impressões) para não depender do formato da Windsor. */
export function buscaDaWindsor(linhas: LinhaWindsor[], dimensao: "query" | "page" | null, limite: number): LinhaBusca[] {
  return linhas
    .map((l) => {
      const cliques = numero(l.clicks) ?? 0;
      const impressoes = numero(l.impressions) ?? 0;
      return { chave: dimensao ? texto(l[dimensao]) : "", cliques, impressoes, ctr: impressoes > 0 ? cliques / impressoes : 0, posicao: numero(l.position) ?? 0 };
    })
    .sort((a, b) => b.cliques - a.cliques || b.impressoes - a.impressoes)
    .slice(0, limite);
}

const semLocal = "Escolha em Conexões qual Perfil da Empresa da Windsor a JUDITE deve ler.";
const semSite = "Escolha em Conexões qual site do Search Console da Windsor a JUDITE deve ler.";

export async function lerLocalWindsor(a: AcessoWindsor, de: string, ate: string): Promise<LocalPerfil> {
  if (!a.local) throw new Error(semLocal);
  const [linha] = await lerWindsor(a.chave, {
    conector: "google_my_business", de, ate, contas: [a.local], tempoLimiteMs: TEMPO_LIMITE_MS,
    campos: [
      "location_title", "location_address_lines", "location_address_locality", "location_address_administrative_area",
      "location_website_uri", "location_primary_phone", "location_primary_category_name", "location_profile_description", "location_regular_hours_periods",
    ],
  });
  if (!linha) throw new Error("A Windsor não devolveu as informações do perfil.");
  return perfilDaWindsor(linha, a.local);
}

export async function lerAvaliacoesWindsor(a: AcessoWindsor, umAnoAtras: string, hoje: string): Promise<Avaliacoes> {
  if (!a.local) throw new Error(semLocal);
  const comum = { conector: "google_my_business", de: umAnoAtras, ate: hoje, contas: [a.local], tempoLimiteMs: TEMPO_LIMITE_MS };
  const [linhas, totais] = await Promise.all([
    lerWindsor(a.chave, { ...comum, campos: ["review_id", "review_reviewer", "review_star_rating", "review_comment", "review_create_time", "review_reply_comment"] }),
    lerWindsor(a.chave, { ...comum, campos: ["review_average_rating_total", "review_total_count"] }),
  ]);
  return avaliacoesDaWindsor(linhas, totais[0]);
}

export async function lerDesempenhoWindsor(a: AcessoWindsor, de: string, ate: string, dias: number): Promise<DesempenhoPerfil> {
  if (!a.local) throw new Error(semLocal);
  const linhas = await lerWindsor(a.chave, {
    conector: "google_my_business", de, ate, contas: [a.local], tempoLimiteMs: TEMPO_LIMITE_MS,
    campos: ["date", "impressions", "website_clicks", "call_clicks", "direction_requests"],
  });
  return desempenhoDaWindsor(linhas, dias);
}

export async function lerBuscaWindsor(a: AcessoWindsor, de: string, ate: string, dimensao: "query" | "page" | null, limite = 25): Promise<LinhaBusca[]> {
  if (!a.siteGsc) throw new Error(semSite);
  const linhas = await lerWindsor(a.chave, {
    conector: "searchconsole", de, ate, contas: [a.siteGsc], tempoLimiteMs: TEMPO_LIMITE_MS,
    campos: [...(dimensao ? [dimensao] : []), "clicks", "impressions", "position"],
  });
  return buscaDaWindsor(linhas, dimensao, limite);
}
