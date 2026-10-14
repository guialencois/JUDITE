/**
 * Ajudantes comuns aos provedores nativos (Meta, Google Ads, TikTok). Só servidor.
 */

const TEMPO_LIMITE_MS = 60000;

/** Erro com mensagem já pronta para mostrar ao usuário (sem token, sem URL). */
export class ErroProvedor extends Error {
  constructor(mensagem: string, readonly status?: number) {
    super(mensagem);
    this.name = "ErroProvedor";
  }
}

/** Faz o pedido com tempo limite e devolve o JSON. Nunca coloca cabeçalhos ou tokens na mensagem de erro. */
export async function pedirJson(
  nome: string,
  url: string,
  init: RequestInit,
  descreverErro: (json: unknown, status: number) => string | null,
): Promise<unknown> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetch(url, { ...init, signal: controle.signal, cache: "no-store" });
    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    const detalhe = descreverErro(json, resposta.status);
    if (!resposta.ok || detalhe) {
      throw new ErroProvedor(`${nome} respondeu ${resposta.status}: ${(detalhe ?? texto).slice(0, 300)}`, resposta.status);
    }
    return json;
  } catch (erro) {
    if (erro instanceof Error && erro.name === "AbortError") {
      throw new ErroProvedor(`${nome} demorou mais de 60s para responder.`);
    }
    throw erro;
  } finally {
    clearTimeout(relogio);
  }
}

export function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor));
  return Number.isFinite(n) ? n : null;
}

export const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
