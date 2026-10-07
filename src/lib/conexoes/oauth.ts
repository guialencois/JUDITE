/**
 * Peças comuns do OAuth das conexões: "state" (proteção contra CSRF), PKCE (S256) e o cookie
 * que guarda os dois entre a ida e a volta. SOMENTE no servidor.
 *
 *  - state: aleatório, guardado em cookie httpOnly e comparado na volta em tempo constante;
 *  - PKCE: o "verificador" fica no cookie e só o hash (desafio) vai para a plataforma. Quem interceptar
 *    o código de autorização não consegue trocá-lo por token sem o verificador.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type PedidoOAuth = { state: string; verificador: string; desafio: string };

/** Desafio PKCE do método S256: base64url(SHA-256(verificador)). */
export function desafioPkce(verificador: string): string {
  return createHash("sha256").update(verificador).digest("base64url");
}

export function novoPedidoOAuth(): PedidoOAuth {
  const verificador = randomBytes(48).toString("base64url"); // 64 caracteres (o padrão pede de 43 a 128)
  return { state: randomBytes(24).toString("base64url"), verificador, desafio: desafioPkce(verificador) };
}

/** Compara o state recebido com o do cookie em tempo constante. Vazio ou ausente nunca confere. */
export function stateConfere(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const cookieOAuthSchema = z.object({
  state: z.string().min(16).max(200),
  workspaceId: z.uuid(),
  verificador: z.string().min(43).max(128).optional(),
  alvo: z.enum(["ads", "presenca"]).default("ads"),
});
export type CookieOAuth = z.infer<typeof cookieOAuthSchema>;

/** Lê o cookie do pedido. Devolve null se estiver ausente, quebrado ou fora do formato. */
export function lerCookieOAuth(bruto: string | null | undefined): CookieOAuth | null {
  if (!bruto) return null;
  try {
    const lido = cookieOAuthSchema.safeParse(JSON.parse(bruto));
    return lido.success ? lido.data : null;
  } catch {
    return null;
  }
}

/** Opções do cookie: httpOnly, só no caminho das rotas da plataforma e válido por 10 minutos. */
export function opcoesDoCookie(site: string, caminho: string) {
  return { httpOnly: true, secure: site.startsWith("https://"), sameSite: "lax" as const, path: caminho, maxAge: 600 };
}
