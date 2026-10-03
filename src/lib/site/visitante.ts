import { createHmac, hkdfSync } from "node:crypto";

/**
 * Código anônimo do visitante: muda todo dia e não guarda IP.
 * HMAC(IP + navegador + site + data) com uma chave só do servidor -> 24 caracteres.
 * Serve só para contar "visitantes únicos do dia"; não dá para voltar ao IP.
 */
function chave(): Buffer {
  const mestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!mestra) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY.");
  return Buffer.from(hkdfSync("sha256", mestra, "judite", "judite-visitante-v1", 32));
}

export function codigoVisitante(siteId: string, ip: string, navegador: string): string {
  const dia = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", chave()).update([siteId, ip, navegador, dia].join("|")).digest("base64url").slice(0, 24);
}
