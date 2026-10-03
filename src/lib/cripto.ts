import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Criptografia dos tokens das conexões (AES-256-GCM), só no servidor.
 *
 * A chave é derivada automaticamente da chave mestra do Supabase (SUPABASE_SERVICE_ROLE_KEY),
 * que já existe no servidor; não é preciso configurar nada a mais.
 * Opcional: JUDITE_CHAVE_CRIPTO (32 bytes em base64) para usar uma chave própria.
 * Atenção: se a chave mestra do Supabase for trocada, as conexões precisam ser refeitas.
 */
function chave(): Buffer {
  const propria = process.env.JUDITE_CHAVE_CRIPTO;
  if (propria) {
    const k = Buffer.from(propria, "base64");
    if (k.length !== 32) throw new Error("JUDITE_CHAVE_CRIPTO precisa ter 32 bytes em base64.");
    return k;
  }
  const mestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!mestra) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (.env.local e Vercel).");
  return Buffer.from(hkdfSync("sha256", mestra, "judite", "judite-conexoes-v1", 32));
}

export function cifrar(dados: Record<string, string>): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave(), iv);
  const corpo = Buffer.concat([cifra.update(JSON.stringify(dados), "utf8"), cifra.final()]);
  return ["v1", iv.toString("base64"), cifra.getAuthTag().toString("base64"), corpo.toString("base64")].join(".");
}

export function decifrar(texto: string): Record<string, string> {
  const [versao, iv, tag, corpo] = texto.split(".");
  if (versao !== "v1" || !iv || !tag || !corpo) throw new Error("Segredo em formato desconhecido.");
  const decifra = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64"));
  decifra.setAuthTag(Buffer.from(tag, "base64"));
  const json = Buffer.concat([decifra.update(Buffer.from(corpo, "base64")), decifra.final()]).toString("utf8");
  return JSON.parse(json) as Record<string, string>;
}

export function criptoConfigurada(): boolean {
  try {
    chave();
    return true;
  } catch {
    return false;
  }
}
