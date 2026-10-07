import type { createClient } from "@/lib/supabase/server";
import { NOME_PLATAFORMA, PLATAFORMAS, type Plataforma } from "@/lib/trafego/tipos";
import { contasEscolhidas, fonteDaPlataforma, type Fonte } from "@/lib/windsor/conexao";
import type { Provedor } from "./segredos";

type Sessao = Awaited<ReturnType<typeof createClient>>;

/** Qual conexão (tabela conexoes) atende cada plataforma do painel, e como chamá-la na tela. */
export const CONEXAO_DA_PLATAFORMA: Record<Plataforma, Provedor> = {
  google_ads: "google_ads",
  facebook: "meta",
  tiktok: "tiktok",
};
const APELIDO: Record<Plataforma, string> = {
  google_ads: "o Google Ads",
  facebook: "a Meta",
  tiktok: "o TikTok",
};

export type SituacaoDasConexoes = {
  /** Plataformas de anúncio que ainda não têm conexão pronta neste workspace. */
  semConexao: { nome: string; apelido: string }[];
  /** De onde vêm os dados e as ações de cada plataforma: conexão própria (padrão) ou Windsor. */
  fontes: Record<Plataforma, Fonte>;
};

/** Regra pura (testada): junta as linhas da tabela conexoes na situação mostrada nas telas de tráfego. */
export function situacaoDe(linhas: { provedor: string; dados?: unknown; conectado_em?: string | null }[]): SituacaoDasConexoes {
  const prontas = new Set(linhas.filter((c) => c.conectado_em).map((c) => c.provedor));
  const windsor = linhas.find((c) => c.provedor === "windsor");
  const fontes = Object.fromEntries(PLATAFORMAS.map((p) => [p, fonteDaPlataforma(windsor?.dados, p)])) as Record<Plataforma, Fonte>;
  const pronta = (p: Plataforma) => fontes[p] === "windsor"
    ? prontas.has("windsor") && contasEscolhidas(windsor?.dados, p).length > 0
    : prontas.has(CONEXAO_DA_PLATAFORMA[p]);
  return {
    semConexao: PLATAFORMAS.filter((p) => !pronta(p)).map((p) => ({ nome: NOME_PLATAFORMA[p], apelido: APELIDO[p] })),
    fontes,
  };
}

/**
 * Situação das conexões de anúncio do workspace. Lê com a sessão do usuário (RLS): só status, nunca os segredos.
 */
export async function situacaoDasConexoes(supabase: Sessao, workspaceId: string): Promise<SituacaoDasConexoes> {
  const { data } = await supabase.from("conexoes").select("provedor, dados, conectado_em").eq("workspace_id", workspaceId);
  return situacaoDe((data ?? []) as { provedor: string; dados?: unknown; conectado_em?: string | null }[]);
}
