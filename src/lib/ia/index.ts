/**
 * Ponto único de acesso à IA da JUDITE (Diretor, Creative Studio e Campaign Manager).
 * O provedor (Gemini ou Anthropic) é escolhido por variável de ambiente; veja ./provedor.
 * SOMENTE no servidor: as chaves nunca vão para o navegador.
 */

import type { z } from "zod";
import { pedirJsonAnthropic } from "./anthropic";
import { pedirJsonGemini } from "./gemini";
import { iaConfigurada, mensagemSemChave, provedorEscolhido } from "./provedor";
import { ErroIA, type PedidoIA, type RespostaIA } from "./tipos";

export { ErroIA, type RespostaIA } from "./tipos";
export { iaConfigurada, mensagemSemChave, provedorEscolhido, provedorParaConfigurar, PROVEDORES_IA, type ProvedorIA } from "./provedor";

/** Pede à IA uma resposta no formato do schema. Lança ErroIA com mensagem em português quando falha. */
export async function pedirJson<T extends z.ZodType>(opcoes: PedidoIA<T>): Promise<RespostaIA<z.infer<T>>> {
  if (!iaConfigurada()) throw new ErroIA(mensagemSemChave());
  return provedorEscolhido() === "gemini" ? pedirJsonGemini(opcoes) : pedirJsonAnthropic(opcoes);
}
