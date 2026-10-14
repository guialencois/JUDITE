/**
 * Ponte JUDITE → LUNIKO. ZERO FUSÃO: a JUDITE não conhece o banco nem o código do LUNIKO.
 * Ela só publica eventos assinados (webhook) com um contrato fixo; o LUNIKO decide o que executar.
 * O contrato está em docs/CONTRATO-LUNIKO.md.
 *
 * Desligada por padrão: sem LUNIKO_WEBHOOK_URL e LUNIKO_WEBHOOK_SECRET nada é enviado.
 * Uma falha no envio nunca derruba a ação da JUDITE (o evento continua no histórico dela).
 */

import { createHmac, randomUUID } from "node:crypto";

export const VERSAO_DO_CONTRATO = "1";
export type TipoDeEvento = "campanha.estado_mudou";

export type Envelope = {
  /** Identificador único do evento: o LUNIKO usa para não processar duas vezes (idempotência). */
  id: string;
  tipo: TipoDeEvento;
  versao: string;
  emitido_em: string;
  dados: Record<string, unknown>;
};

export const pontePronta = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.LUNIKO_WEBHOOK_URL?.trim() && env.LUNIKO_WEBHOOK_SECRET?.trim());

/** Assinatura HMAC-SHA256 de "<timestamp>.<corpo>", em hexadecimal. O LUNIKO refaz a conta com o mesmo segredo. */
export function assinar(corpo: string, timestamp: string, segredo: string): string {
  return createHmac("sha256", segredo).update(`${timestamp}.${corpo}`).digest("hex");
}

export function montarEnvelope(tipo: TipoDeEvento, dados: Record<string, unknown>, agora = new Date()): Envelope {
  return { id: randomUUID(), tipo, versao: VERSAO_DO_CONTRATO, emitido_em: agora.toISOString(), dados };
}

export type ResultadoEnvio = { enviado: boolean; motivo?: string };

export async function emitirEvento(tipo: TipoDeEvento, dados: Record<string, unknown>): Promise<ResultadoEnvio> {
  if (!pontePronta()) return { enviado: false, motivo: "Ponte com o LUNIKO não configurada." };
  const envelope = montarEnvelope(tipo, dados);
  const corpo = JSON.stringify(envelope);
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const resposta = await fetch(String(process.env.LUNIKO_WEBHOOK_URL).trim(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-judite-evento": envelope.id,
        "x-judite-timestamp": timestamp,
        "x-judite-assinatura": assinar(corpo, timestamp, String(process.env.LUNIKO_WEBHOOK_SECRET).trim()),
      },
      body: corpo,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    return resposta.ok ? { enviado: true } : { enviado: false, motivo: `O LUNIKO respondeu ${resposta.status}.` };
  } catch {
    return { enviado: false, motivo: "Não foi possível falar com o LUNIKO (rede ou tempo esgotado)." };
  }
}
