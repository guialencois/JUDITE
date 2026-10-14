import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MODELO_GEMINI, pedirJsonGemini } from "./gemini";
import { iaConfigurada, mensagemSemChave, provedorEscolhido, provedorParaConfigurar } from "./provedor";
import { ErroIA } from "./tipos";

describe("escolha do provedor de IA", () => {
  it("sem IA_PROVEDOR, usa o Gemini quando GEMINI_API_KEY existe", () => {
    expect(provedorEscolhido({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toBe("gemini");
  });

  it("sem IA_PROVEDOR e sem GEMINI_API_KEY, usa a Anthropic", () => {
    expect(provedorEscolhido({ ANTHROPIC_API_KEY: "a" })).toBe("anthropic");
    expect(provedorEscolhido({ GEMINI_API_KEY: "   " })).toBe("anthropic");
  });

  it("IA_PROVEDOR manda, mesmo com a outra chave presente", () => {
    expect(provedorEscolhido({ IA_PROVEDOR: "anthropic", GEMINI_API_KEY: "g" })).toBe("anthropic");
    expect(provedorEscolhido({ IA_PROVEDOR: " Gemini ", ANTHROPIC_API_KEY: "a" })).toBe("gemini");
  });

  it("valor desconhecido em IA_PROVEDOR cai na regra padrão", () => {
    expect(provedorEscolhido({ IA_PROVEDOR: "openai", GEMINI_API_KEY: "g" })).toBe("gemini");
    expect(provedorEscolhido({ IA_PROVEDOR: "openai" })).toBe("anthropic");
  });

  it("iaConfigurada olha só a chave do provedor escolhido", () => {
    expect(iaConfigurada({ GEMINI_API_KEY: "g" })).toBe(true);
    expect(iaConfigurada({ ANTHROPIC_API_KEY: "a" })).toBe(true);
    expect(iaConfigurada({})).toBe(false);
    expect(iaConfigurada({ IA_PROVEDOR: "gemini", ANTHROPIC_API_KEY: "a" })).toBe(false);
    expect(iaConfigurada({ IA_PROVEDOR: "anthropic", GEMINI_API_KEY: "g" })).toBe(false);
  });

  it("a mensagem de chave faltando cita a variável certa", () => {
    expect(provedorParaConfigurar({})).toBe("gemini");
    expect(mensagemSemChave({})).toContain("GEMINI_API_KEY");
    expect(mensagemSemChave({ IA_PROVEDOR: "anthropic" })).toContain("ANTHROPIC_API_KEY");
    expect(mensagemSemChave({ IA_PROVEDOR: "gemini", ANTHROPIC_API_KEY: "a" })).toContain("GEMINI_API_KEY");
  });
});

const CHAVE = "chave-secreta-de-teste";
const schema = z.object({ titulo: z.string(), nota: z.number().nullable() });
const pedido = { schema, sistema: "Você é a JUDITE.", usuario: "Responda em JSON." };

const comTexto = (texto: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts: [{ text: texto }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, thoughtsTokenCount: 3 },
  modelVersion: MODELO_GEMINI,
  ...extra,
});

function simularFetch(corpo: unknown, status = 200) {
  const falso = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(corpo), { status }));
  vi.stubGlobal("fetch", falso);
  return falso;
}

async function erroDe(promessa: Promise<unknown>): Promise<ErroIA> {
  const erro = await promessa.then(() => null, (e: unknown) => e);
  expect(erro).toBeInstanceOf(ErroIA);
  return erro as ErroIA;
}

describe("provedor Gemini", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("envia a chave no cabeçalho (nunca na URL) e o schema JSON gerado do zod", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    const falso = simularFetch(comTexto('{"titulo":"Passeio","nota":null}'));

    const resposta = await pedirJsonGemini({ ...pedido, maxTokens: 500 });

    expect(resposta).toEqual({ dados: { titulo: "Passeio", nota: null }, modelo: MODELO_GEMINI, tokensEntrada: 12, tokensSaida: 8 });
    const [url, init] = falso.mock.calls[0];
    expect(String(url)).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`);
    expect(String(url)).not.toContain(CHAVE);
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe(CHAVE);
    const corpo = JSON.parse(String(init?.body));
    expect(corpo.systemInstruction.parts[0].text).toBe(pedido.sistema);
    expect(corpo.contents[0].parts[0].text).toBe(pedido.usuario);
    expect(corpo.generationConfig.maxOutputTokens).toBe(500);
    expect(corpo.generationConfig.responseMimeType).toBe("application/json");
    expect(corpo.generationConfig.responseJsonSchema.type).toBe("object");
    expect(corpo.generationConfig.responseJsonSchema.required).toEqual(["titulo", "nota"]);
    expect(corpo.generationConfig.responseJsonSchema.$schema).toBeUndefined();
  });

  it("ignora as partes de raciocínio ao montar o texto", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    simularFetch({ candidates: [{ content: { parts: [{ text: "pensando...", thought: true }, { text: '{"titulo":"A",' }, { text: '"nota":4.5}' }] }, finishReason: "STOP" }] });
    const resposta = await pedirJsonGemini(pedido);
    expect(resposta.dados).toEqual({ titulo: "A", nota: 4.5 });
    expect(resposta.tokensEntrada).toBe(0);
  });

  it("recusa resposta que não é JSON", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    simularFetch(comTexto("Claro! Aqui está a resposta."));
    expect((await erroDe(pedirJsonGemini(pedido))).message).toContain("fora do formato");
  });

  it("recusa JSON que não bate com o schema zod", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    simularFetch(comTexto('{"titulo":123}'));
    expect((await erroDe(pedirJsonGemini(pedido))).message).toContain("fora do formato");
  });

  it("explica chave recusada sem mostrar a chave", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    simularFetch({ error: { code: 400, status: "INVALID_ARGUMENT", message: `API key not valid: ${CHAVE}`, details: [{ reason: "API_KEY_INVALID" }] } }, 400);
    const erro = await erroDe(pedirJsonGemini(pedido));
    expect(erro.message).toContain("GEMINI_API_KEY foi recusada");
    expect(erro.message).not.toContain(CHAVE);
  });

  it("não deixa a chave vazar no detalhe de um pedido recusado", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    simularFetch({ error: { status: "INVALID_ARGUMENT", message: `campo inválido (${CHAVE})` } }, 400);
    const erro = await erroDe(pedirJsonGemini(pedido));
    expect(erro.message).toContain("recusou o pedido");
    expect(erro.message).not.toContain(CHAVE);
  });

  it("explica a cota grátis esgotada (429)", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    simularFetch({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }, 429);
    expect((await erroDe(pedirJsonGemini(pedido))).message).toContain("cota grátis");
  });

  it("explica pedido bloqueado e resposta bloqueada por segurança", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    simularFetch({ promptFeedback: { blockReason: "SAFETY" } });
    expect((await erroDe(pedirJsonGemini(pedido))).message).toContain("bloqueou este pedido");
    simularFetch({ candidates: [{ finishReason: "SAFETY" }] });
    expect((await erroDe(pedirJsonGemini(pedido))).message).toContain("bloqueou a resposta");
  });

  it("explica resposta cortada por tamanho", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    simularFetch({ candidates: [{ content: { parts: [{ text: '{"titulo":"A' }] }, finishReason: "MAX_TOKENS" }] });
    expect((await erroDe(pedirJsonGemini(pedido))).message).toContain("cortada");
  });

  it("explica falha de rede", async () => {
    vi.stubEnv("GEMINI_API_KEY", CHAVE);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError(`fetch failed ${CHAVE}`); }));
    const erro = await erroDe(pedirJsonGemini(pedido));
    expect(erro.message).toContain("rede");
    expect(erro.message).not.toContain(CHAVE);
  });

  it("sem chave, nem chama o Google", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const falso = simularFetch({});
    expect((await erroDe(pedirJsonGemini(pedido))).message).toContain("GEMINI_API_KEY");
    expect(falso).not.toHaveBeenCalled();
  });
});
