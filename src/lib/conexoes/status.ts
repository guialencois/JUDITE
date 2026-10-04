import type { createClient } from "@/lib/supabase/server";
import { NOME_PLATAFORMA, PLATAFORMAS, type Plataforma } from "@/lib/trafego/tipos";
import type { Provedor } from "./segredos";

type Sessao = Awaited<ReturnType<typeof createClient>>;

/** Qual conexão (tabela conexoes) atende cada plataforma do painel, e como chamá-la na tela. */
export const CONEXAO_DA_PLATAFORMA: Record<Plataforma, Provedor> = {
  google_ads: "google_ads",
  facebook: "meta",
};
const APELIDO: Record<Plataforma, string> = {
  google_ads: "o Google Ads",
  facebook: "a Meta",
};

/**
 * Plataformas de anúncio que ainda não têm conexão pronta neste workspace.
 * Lê com a sessão do usuário (RLS): só status, nunca os segredos.
 */
export async function plataformasSemConexao(supabase: Sessao, workspaceId: string) {
  const { data } = await supabase.from("conexoes").select("provedor, conectado_em").eq("workspace_id", workspaceId);
  const prontas = new Set((data ?? []).filter((c) => c.conectado_em).map((c) => c.provedor as string));
  return PLATAFORMAS
    .filter((p) => !prontas.has(CONEXAO_DA_PLATAFORMA[p]))
    .map((p) => ({ nome: NOME_PLATAFORMA[p], apelido: APELIDO[p] }));
}
