/**
 * Cliente do servidor MCP da Windsor.ai, usado pelo servidor da JUDITE para as AÇÕES de escrita
 * (pausar, ativar, orçamento, criar campanha pausada) e para listar as contas ligadas à chave.
 *
 * Documentação (conferida em 07/10/2026):
 *   https://windsor.ai/documentation/windsor-mcp/write-actions/
 *   https://github.com/windsor-ai/windsor_mcp  e  https://mcp.windsor.ai/llms-full.txt
 *   Endereço (Streamable HTTP): https://mcp.windsor.ai/
 *   Autenticação sem login interativo: "Authorization: Bearer <chave de API da Windsor>".
 *   Ferramentas usadas aqui: get_connectors e execute_action(connector, action, account, params).
 *
 * Aqui a chave vai no cabeçalho, nunca na URL. Mesmo assim, todo texto de erro passa por semChave().
 * SOMENTE no servidor. Quem chama execute_action já passou pelos freios de src/lib/trafego.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErroProvedor } from "@/lib/anuncios/http";
import { semChave } from "./api";
import { CONECTORES_WINDSOR, type ConectorWindsor, type ContaWindsor } from "./conexao";

const MCP_URL = "https://mcp.windsor.ai/";
const TEMPO_LIMITE_MS = 60_000;

/** Chama uma ferramenta do MCP da Windsor e devolve o resultado já interpretado. */
export type ChamarWindsor = (chave: string, ferramenta: string, argumentos: Record<string, unknown>) => Promise<unknown>;

type Conteudo = { type?: string; text?: string };
type Resultado = { content?: Conteudo[]; structuredContent?: unknown; isError?: boolean };

const textoDe = (r: Resultado): string => (r.content ?? []).filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");

/** Tira o resultado útil da resposta de uma ferramenta. Exportada para os testes. */
export function interpretarResultado(r: Resultado): unknown {
  let valor: unknown = r.structuredContent;
  if (valor === undefined || valor === null) {
    const texto = textoDe(r);
    try {
      valor = texto ? JSON.parse(texto) : null;
    } catch {
      valor = texto;
    }
  }
  // O servidor embrulha listas e valores simples em { "result": ... }.
  const o = valor as Record<string, unknown> | null;
  return o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 1 && "result" in o ? o.result : valor;
}

const ehRecusaDeChave = (erro: unknown): boolean => {
  const e = erro as { name?: string; code?: unknown; message?: string } | null;
  return e?.name === "UnauthorizedError" || e?.code === 401 || /\b401\b|unauthorized|invalid_token/i.test(e?.message ?? "");
};

export const chamarWindsor: ChamarWindsor = async (chave, ferramenta, argumentos) => {
  const cliente = new Client({ name: "judite", version: "1.0.0" });
  const transporte = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${chave}` }, cache: "no-store" },
  });
  try {
    await cliente.connect(transporte, { timeout: TEMPO_LIMITE_MS });
    const r = (await cliente.callTool({ name: ferramenta, arguments: argumentos }, undefined, { timeout: TEMPO_LIMITE_MS })) as Resultado;
    if (r.isError) {
      throw new ErroProvedor(`A Windsor recusou a ação: ${semChave(textoDe(r) || "sem detalhe", chave).slice(0, 300)}`);
    }
    return interpretarResultado(r);
  } catch (erro) {
    if (erro instanceof ErroProvedor) throw erro;
    if (ehRecusaDeChave(erro)) throw new ErroProvedor("A Windsor recusou a chave de API. Confira a chave na página Conexões.", 401);
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    throw new ErroProvedor(`Não foi possível falar com a Windsor: ${semChave(mensagem, chave).slice(0, 300)}`);
  } finally {
    await cliente.close().catch(() => undefined);
  }
};

/**
 * Confere a chave na Windsor e devolve as contas ligadas lá, por conector (só os que a JUDITE usa).
 * Chave errada vira ErroProvedor com status 401.
 */
export async function listarContasWindsor(chave: string, chamar: ChamarWindsor = chamarWindsor): Promise<Partial<Record<ConectorWindsor, ContaWindsor[]>>> {
  const bruto = await chamar(chave, "get_connectors", { include_actions: false, include_options: false });
  if (!Array.isArray(bruto)) throw new ErroProvedor("A Windsor devolveu a lista de contas em um formato inesperado.");
  const saida: Partial<Record<ConectorWindsor, ContaWindsor[]>> = {};
  for (const item of bruto as { id?: unknown; accounts?: unknown }[]) {
    const conector = CONECTORES_WINDSOR.find((c) => c === item?.id);
    if (!conector || !Array.isArray(item.accounts)) continue;
    saida[conector] = (item.accounts as { id?: unknown; name?: unknown }[])
      .filter((a) => typeof a?.id === "string" || typeof a?.id === "number")
      .map((a) => ({ id: String(a.id), nome: (typeof a.name === "string" && a.name ? a.name : String(a.id)).slice(0, 200) }));
  }
  return saida;
}
