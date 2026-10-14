/**
 * Escolha do provedor de IA pela variável IA_PROVEDOR ("gemini" ou "anthropic").
 * Sem ela (ou com valor desconhecido): Gemini se GEMINI_API_KEY existir, senão Anthropic.
 */

export type ProvedorIA = "gemini" | "anthropic";
type Ambiente = Record<string, string | undefined>;

export const PROVEDORES_IA: Record<ProvedorIA, { nome: string; variavel: string; ondeCriar: string; custo: string }> = {
  gemini: {
    nome: "Google Gemini",
    variavel: "GEMINI_API_KEY",
    ondeCriar: "aistudio.google.com/apikey",
    custo: "O plano grátis do Google AI Studio tem um limite de pedidos por minuto e por dia; ao atingir, a tela avisa.",
  },
  anthropic: {
    nome: "Anthropic (Claude)",
    variavel: "ANTHROPIC_API_KEY",
    ondeCriar: "console.anthropic.com",
    custo: "O uso da IA é cobrado pela Anthropic conforme o consumo.",
  },
};

const preenchida = (valor: string | undefined): boolean => Boolean(valor?.trim());

function provedorPedido(env: Ambiente): ProvedorIA | null {
  const pedido = env.IA_PROVEDOR?.trim().toLowerCase();
  return pedido === "gemini" || pedido === "anthropic" ? pedido : null;
}

export function provedorEscolhido(env: Ambiente = process.env): ProvedorIA {
  return provedorPedido(env) ?? (preenchida(env.GEMINI_API_KEY) ? "gemini" : "anthropic");
}

export function iaConfigurada(env: Ambiente = process.env): boolean {
  return preenchida(env[PROVEDORES_IA[provedorEscolhido(env)].variavel]);
}

/**
 * Provedor que as telas devem citar quando falta a chave. Se ninguém escolheu um provedor
 * e não há chave nenhuma, a orientação é a do Gemini (plano grátis).
 */
export function provedorParaConfigurar(env: Ambiente = process.env): ProvedorIA {
  return provedorPedido(env) ?? (iaConfigurada(env) ? provedorEscolhido(env) : "gemini");
}

export function mensagemSemChave(env: Ambiente = process.env): string {
  return `Falta a variável ${PROVEDORES_IA[provedorParaConfigurar(env)].variavel} no servidor.`;
}
