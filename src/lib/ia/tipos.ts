/**
 * Tipos comuns da IA da JUDITE, iguais para qualquer provedor (Gemini ou Anthropic).
 */

import type { z } from "zod";

export class ErroIA extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroIA";
  }
}

export type RespostaIA<T> = { dados: T; modelo: string; tokensEntrada: number; tokensSaida: number };

export type PedidoIA<T extends z.ZodType> = {
  schema: T;
  sistema: string;
  usuario: string;
  maxTokens?: number;
};
