/**
 * Cliente da API REST de leitura da Windsor.ai. SOMENTE no servidor.
 *
 * Documentação (conferida em 07/10/2026): https://windsor.ai/api-documentation/
 *   GET https://connectors.windsor.ai/{conector}?api_key=...&fields=a,b&date_from=AAAA-MM-DD&date_to=AAAA-MM-DD&select_accounts=x,y
 *   Resposta: { "data": [ { campo: valor, ... } ] }
 *   Erro:     { "error": "texto", "code": "user_error" }  ou  { "error": { "code": "...", "message": "..." } }
 *
 * ATENÇÃO: esta API só aceita a chave na URL (não aceita cabeçalho). Por isso a URL NUNCA entra em log
 * nem em mensagem de erro, e todo texto que volta da Windsor passa por semChave() antes de sair daqui:
 * a própria Windsor repete a chave na resposta quando ela é recusada.
 */

import { ErroProvedor } from "@/lib/anuncios/http";

const BASE = "https://connectors.windsor.ai";
/** A Windsor busca os dados na plataforma na hora do pedido; relatórios grandes demoram. */
const TEMPO_LIMITE_MS = 120_000;

export type LinhaWindsor = Record<string, unknown>;

/** Tira a chave (pura e codificada para URL) e qualquer endereço da Windsor de um texto. */
export function semChave(texto: string, chave: string): string {
  let limpo = texto;
  for (const forma of new Set([chave, encodeURIComponent(chave)])) {
    if (forma) limpo = limpo.split(forma).join("***");
  }
  return limpo.replace(/https?:\/\/[^\s"'<>]*windsor\.ai[^\s"'<>]*/gi, "[endereço da Windsor]");
}

function erroDaWindsor(json: unknown): string | null {
  const e = (json as { error?: unknown } | null)?.error;
  if (!e) return null;
  if (typeof e === "string") return e;
  const o = e as { message?: unknown; code?: unknown };
  return typeof o.message === "string" ? o.message : typeof o.code === "string" ? o.code : "erro desconhecido";
}

export type PedidoWindsor = {
  conector: string;
  campos: string[];
  de: string;
  ate: string;
  /** IDs das contas na Windsor. Vazio = todas as contas ligadas à chave. */
  contas?: string[];
  /** Para telas que leem ao vivo e não podem esperar os 2 minutos da sincronização. */
  tempoLimiteMs?: number;
};

/** Lê linhas de um conector. Qualquer falha vira ErroProvedor com mensagem em português, sem chave e sem URL. */
export async function lerWindsor(chave: string, p: PedidoWindsor): Promise<LinhaWindsor[]> {
  const busca = new URLSearchParams({
    api_key: chave,
    fields: p.campos.join(","),
    date_from: p.de,
    date_to: p.ate,
    _renderer: "json",
  });
  if (p.contas?.length) busca.set("select_accounts", p.contas.join(","));

  const controle = new AbortController();
  const limite = p.tempoLimiteMs ?? TEMPO_LIMITE_MS;
  const relogio = setTimeout(() => controle.abort(), limite);
  let status: number;
  let corpo: string;
  try {
    const resposta = await fetch(`${BASE}/${encodeURIComponent(p.conector)}?${busca.toString()}`, { signal: controle.signal, cache: "no-store" });
    status = resposta.status;
    corpo = await resposta.text();
  } catch (erro) {
    if (erro instanceof Error && erro.name === "AbortError") {
      throw new ErroProvedor(`A Windsor demorou mais de ${Math.round(limite / 1000)}s para responder. Ela pode estar buscando os dados pela primeira vez: tente de novo em alguns minutos.`);
    }
    // O erro de rede pode carregar o endereço pedido (com a chave): só o nome do erro segue adiante.
    throw new ErroProvedor("Não foi possível falar com a Windsor (falha de rede). Tente de novo em instantes.");
  } finally {
    clearTimeout(relogio);
  }

  let json: unknown = null;
  try {
    json = corpo ? JSON.parse(corpo) : null;
  } catch {
    json = null;
  }
  const detalhe = erroDaWindsor(json);
  if (status < 200 || status >= 300 || detalhe) {
    if (status === 401 || status === 403 || /api key/i.test(detalhe ?? "")) {
      throw new ErroProvedor("A Windsor recusou a chave de API. Confira a chave na página Conexões.", status);
    }
    throw new ErroProvedor(`A Windsor respondeu ${status}: ${semChave(detalhe ?? corpo, chave).slice(0, 300)}`, status);
  }
  const linhas = (json as { data?: unknown } | null)?.data ?? json;
  return Array.isArray(linhas) ? (linhas as LinhaWindsor[]) : [];
}
