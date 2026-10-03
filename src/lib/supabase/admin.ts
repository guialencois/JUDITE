import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/env";

/**
 * Cliente com a chave mestra (service role): passa por cima do RLS.
 * Usado SOMENTE em rotas de servidor, e SEMPRE depois de checar quem pediu
 * (cron com segredo, ou usuário logado com o papel certo no workspace).
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("O cliente admin do Supabase não pode rodar no navegador.");
  }
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (.env.local e Vercel).");
  return createClient(supabaseUrl, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}
