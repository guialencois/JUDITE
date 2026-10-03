import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Criptografia dos tokens das conexões (AES-256-GCM).
 * A chave fica só no servidor, na variável JUDITE_CHAVE_CRIPTO (32 bytes em base64).
 * Mesmo que alguém copie o banco, os tokens não servem sem essa chave.
 */
function chave(): Buffer {
  const b64 = process.env.JUDITE_CHAVE_CRIPTO;
  if (!b64) throw new Error("Falta JUDITE_CHAVE_CRIPTO (.env.local e Vercel).");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("JUDITE_CHAVE_CRIPTO precisa ter 32 bytes em base64.");
  return k;
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
