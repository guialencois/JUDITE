/**
 * Provedor Google Gemini pela API REST oficial (generateContent), sem SDK. SOMENTE no servidor.
 * A chave GEMINI_API_KEY vai no cabeçalho x-goog-api-key (nunca na URL) e nunca aparece em erro ou log.
 *
 * A saída é pedida em JSON com o JSON Schema gerado do zod (responseMimeType + responseJsonSchema)
 * e validada de novo com o mesmo schema zod antes de voltar para quem chamou.
 * Referência: ai.google.dev/api/generate-content e ai.google.dev/gemini-api/docs/structured-output
 */

import { z } from "zod";
import { ErroIA, type PedidoIA, type RespostaIA } from "./tipos";

/** Flash estável mais recente com cota grátis (conferido em ai.google.dev em 04/10/2026). */
export const MODELO_GEMINI = "gemini-3.8-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const TEMPO_LIMITE_MS = 120_000;

type RespostaGemini = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { status?: string; message?: string };
};

function erroHttp(status: number, corpo: RespostaGemini | null, chave: string): ErroIA {
  const detalhe = (corpo?.error?.message ?? "").split(chave).join("***").slice(0, 200);
  const chaveInvalida = /API_KEY_INVALID|API key not valid|API key expired/i.test(JSON.stringify(corpo?.error ?? ""));
  if (status === 401 || status === 403 || chaveInvalida) {
    return new ErroIA("A chave GEMINI_API_KEY foi recusada pelo Google. Confira o valor na Vercel (ou crie outra em aistudio.google.com/apikey).");
  }
  if (status === 429) {
    return new ErroIA("A cota grátis do Gemini acabou por agora (limite por minuto ou por dia). Tente de novo em alguns minutos ou amanhã.");
  }
  if (status === 404) return new ErroIA(`O Gemini não encontrou o modelo ${MODELO_GEMINI}. Ele pode ter sido desativado pelo Google.`);
  if (status === 400) return new ErroIA("O Gemini recusou o pedido" + (detalhe ? ": " + detalhe : "."));
  if (status >= 500) return new ErroIA("O Gemini está fora do ar ou sobrecarregado. Tente de novo em alguns minutos.");
  return new ErroIA(`O Gemini respondeu com erro ${status}. Tente de novo mais tarde.`);
}

export async function pedirJsonGemini<T extends z.ZodType>(opcoes: PedidoIA<T>): Promise<RespostaIA<z.infer<T>>> {
  const chave = process.env.GEMINI_API_KEY?.trim();
  if (!chave) throw new ErroIA("Falta a variável GEMINI_API_KEY no servidor.");

  const esquema = { ...(z.toJSONSchema(opcoes.schema) as Record<string, unknown>) };
  delete esquema.$schema;

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}/models/${MODELO_GEMINI}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opcoes.sistema }] },
        contents: [{ role: "user", parts: [{ text: opcoes.usuario }] }],
        generationConfig: {
          maxOutputTokens: opcoes.maxTokens ?? 16000,
          responseMimeType: "application/json",
          responseJsonSchema: esquema,
        },
      }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      cache: "no-store",
    });
  } catch {
    throw new ErroIA("Não foi possível falar com o Gemini (rede ou tempo esgotado).");
  }

  const corpo = (await resposta.json().catch(() => null)) as RespostaGemini | null;
  if (!resposta.ok) throw erroHttp(resposta.status, corpo, chave);
  if (!corpo) throw new ErroIA("A IA respondeu fora do formato esperado. Tente de novo.");

  const candidato = corpo.candidates?.[0];
  if (corpo.promptFeedback?.blockReason || !candidato) {
    throw new ErroIA("O Gemini bloqueou este pedido pelos filtros de segurança.");
  }
  if (candidato.finishReason === "MAX_TOKENS") throw new ErroIA("A resposta da IA ficou grande demais e foi cortada. Tente de novo.");
  if (candidato.finishReason && candidato.finishReason !== "STOP") {
    throw new ErroIA("O Gemini bloqueou a resposta pelos filtros de segurança.");
  }

  const texto = (candidato.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new ErroIA("A IA respondeu fora do formato esperado. Tente de novo.");
  }
  const validada = opcoes.schema.safeParse(bruto);
  if (!validada.success) throw new ErroIA("A IA respondeu fora do formato esperado. Tente de novo.");

  const uso = corpo.usageMetadata;
  return {
    dados: validada.data,
    modelo: corpo.modelVersion ?? MODELO_GEMINI,
    tokensEntrada: uso?.promptTokenCount ?? 0,
    tokensSaida: (uso?.candidatesTokenCount ?? 0) + (uso?.thoughtsTokenCount ?? 0),
  };
}
