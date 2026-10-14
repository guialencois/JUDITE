/**
 * Níveis de autonomia da JUDITE. A implementação continua SEGURA por padrão:
 *   - todo workspace começa no nível 1 (assistido) e com a chave do dinheiro ("ligada") desligada;
 *   - os níveis 3 e 4 estão desenhados, mas a aplicação ainda não permite ligar (disponivel = false);
 *   - a coluna autonomia.ligada continua mandando no dinheiro: "Parar tudo" derruba para o nível 1 na hora.
 */

export type Nivel = 0 | 1 | 2 | 3 | 4;

export const NIVEIS: Record<Nivel, { nome: string; resumo: string; disponivel: boolean }> = {
  0: { nome: "Manual", resumo: "A JUDITE só trabalha quando você pede. Nada de proposta automática.", disponivel: true },
  1: { nome: "Assistido", resumo: "Todo dia ela analisa, propõe uma campanha e espera a sua aprovação. Não muda nada sozinha.", disponivel: true },
  2: {
    nome: "Autonomia controlada",
    resumo: "Além de propor, ela pausa campanha ruim e ajusta a verba sozinha, só dentro dos Limites da IA. O que passar do limite espera você.",
    disponivel: true,
  },
  3: {
    nome: "Autonomia avançada",
    resumo: "Criar, testar e otimizar campanhas sozinha, dentro do orçamento. Ainda não liberado nesta versão.",
    disponivel: false,
  },
  4: {
    nome: "CMO autônoma",
    resumo: "Coordenar marketing, campanhas, testes e orçamento continuamente. Ainda não liberado nesta versão.",
    disponivel: false,
  },
};

/** Maior nível que a aplicação aceita ligar hoje. */
export const NIVEL_MAXIMO_LIBERADO: Nivel = 2;

/**
 * Nível que vale de verdade. Sem linha (ou antes da migração) = nível 1.
 * "ligada" é a chave do dinheiro: desligada, o nível nunca passa de 1; ligada, vale pelo menos 2.
 * Qualquer valor acima do liberado é rebaixado (mesmo que alguém grave 3 ou 4 direto no banco).
 */
export function nivelEfetivo(linha: { ligada?: unknown; nivel?: unknown } | null | undefined): Nivel {
  const gravado = Number.isInteger(linha?.nivel) ? Number(linha?.nivel) : 1;
  const ligada = linha?.ligada === true;
  const nivel = ligada ? Math.max(2, gravado) : Math.min(1, gravado);
  return Math.max(0, Math.min(NIVEL_MAXIMO_LIBERADO, nivel)) as Nivel;
}

export type Permissoes = {
  /** Montar proposta de campanha sozinha, todo dia. */
  proporTodoDia: boolean;
  /** Pausar campanha ruim e ajustar verba dentro dos limites (regras de src/lib/diretor/autonomia.ts). */
  ajustarVerbaSozinha: boolean;
  /** Criar campanha na plataforma sem aprovação. Sempre false nesta versão. */
  criarCampanhaSemAprovacao: boolean;
  /** Ligar campanha (começar a gastar) sem aprovação. Sempre false nesta versão. */
  ativarCampanhaSemAprovacao: boolean;
};

export function permissoes(nivel: Nivel): Permissoes {
  return {
    proporTodoDia: nivel >= 1,
    ajustarVerbaSozinha: nivel >= 2,
    criarCampanhaSemAprovacao: false,
    ativarCampanhaSemAprovacao: false,
  };
}

/** Confere um pedido de troca de nível. Devolve o motivo quando não pode. */
export function podeDefinirNivel(pedido: number, papel: string, ciente: boolean): string | null {
  if (!Number.isInteger(pedido) || pedido < 0 || pedido > 4) return "Nível de autonomia inválido.";
  if (papel !== "owner") return "Só o dono do workspace pode mudar o nível de autonomia.";
  if (!NIVEIS[pedido as Nivel].disponivel) return `O nível ${pedido} (${NIVEIS[pedido as Nivel].nome}) ainda não está liberado nesta versão.`;
  if (pedido >= 2 && !ciente) return "Para ligar a autonomia sobre a verba, marque a caixa confirmando que você leu as regras.";
  return null;
}
