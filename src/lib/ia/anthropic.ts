/**
 * Provedor Anthropic (Claude API, SDK oficial). SOMENTE no servidor:
 * a chave ANTHROPIC_API_KEY nunca vai para o navegador.
 *
 * A resposta vem em JSON no formato de um schema zod (saída estruturada) e é validada de novo
 * por quem chama.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { ErroIA, type PedidoIA, type RespostaIA } from "./tipos";

export const MODELO_ANTHROPIC = "claude-sonnet-5-5";

export async function pedirJsonAnthropic<T extends z.ZodType>(opcoes: PedidoIA<T>): Promise<RespostaIA<z.infer<T>>> {
  if (!process.env.ANTHROPIC_API_KEY) throw new ErroIA("Falta a variável ANTHROPIC_API_KEY no servidor.");
  const cliente = new Anthropic();

  try {
    const resposta = await cliente.messages.parse({
      model: MODELO_ANTHROPIC,
      max_tokens: opcoes.maxTokens ?? 16000,
      output_config: { effort: "medium", format: zodOutputFormat(opcoes.schema) },
      system: opcoes.sistema,
      messages: [{ role: "user", content: opcoes.usuario }],
    });

    if (resposta.stop_reason === "refusal") throw new ErroIA("A IA se recusou a responder a este pedido.");
    if (resposta.stop_reason === "max_tokens") throw new ErroIA("A resposta da IA ficou grande demais e foi cortada. Tente de novo.");
    if (!resposta.parsed_output) throw new ErroIA("A IA respondeu fora do formato esperado. Tente de novo.");

    return {
      dados: resposta.parsed_output,
      modelo: resposta.model,
      tokensEntrada: resposta.usage.input_tokens,
      tokensSaida: resposta.usage.output_tokens,
    };
  } catch (erro) {
    if (erro instanceof ErroIA) throw erro;
    if (erro instanceof Anthropic.AuthenticationError) throw new ErroIA("A chave ANTHROPIC_API_KEY foi recusada. Confira o valor na Vercel.");
    if (erro instanceof Anthropic.PermissionDeniedError) throw new ErroIA("A chave da Anthropic não tem permissão para usar este modelo.");
    if (erro instanceof Anthropic.RateLimitError) throw new ErroIA("Limite de uso da Claude API atingido. Tente de novo em alguns minutos.");
    if (erro instanceof Anthropic.BadRequestError) throw new ErroIA("A Claude API recusou o pedido: " + erro.message.slice(0, 200));
    if (erro instanceof Anthropic.APIConnectionError) throw new ErroIA("Não foi possível falar com a Claude API (rede ou tempo esgotado).");
    if (erro instanceof Anthropic.APIError) throw new ErroIA(`A Claude API respondeu com erro ${erro.status ?? ""}. Tente de novo mais tarde.`);
    throw new ErroIA("Erro inesperado ao falar com a IA.");
  }
}
