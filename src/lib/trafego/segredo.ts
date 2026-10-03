import { timingSafeEqual } from "node:crypto";

/** Compara segredos em tempo constante (evita descobrir o segredo pelo tempo de resposta). */
export function segredoConfere(recebido: string | null | undefined, esperado: string | undefined): boolean {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Chamada do cron: Vercel manda "Authorization: Bearer CRON_SECRET"; testes manuais usam x-cron-secret. */
export function ehChamadaDoCron(req: Request): boolean {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  return (
    segredoConfere(bearer, process.env.CRON_SECRET) ||
    segredoConfere(req.headers.get("x-cron-secret"), process.env.TRAFEGO_CRON_SECRET)
  );
}
