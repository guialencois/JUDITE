import { cifrar, decifrar } from "@/lib/cripto";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;
export type Provedor = "google_ads" | "meta" | "tiktok";

/**
 * Lê a conexão de um workspace com os segredos já abertos. SOMENTE no servidor,
 * e só depois de conferir quem está pedindo.
 */
export async function lerConexao(db: Admin, workspaceId: string, provedor: Provedor) {
  const { data } = await db
    .from("conexoes")
    .select("dados, segredo")
    .eq("workspace_id", workspaceId)
    .eq("provedor", provedor)
    .maybeSingle();
  return {
    existe: Boolean(data),
    dados: ((data?.dados as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>,
    segredos: data?.segredo ? decifrar(data.segredo as string) : ({} as Record<string, string>),
  };
}

/** Grava a conexão juntando com o que já existia (campos vazios não apagam valores salvos). */
export async function gravarConexao(
  db: Admin,
  workspaceId: string,
  provedor: Provedor,
  usuarioId: string,
  mudancas: { dados?: Record<string, unknown>; segredos?: Record<string, string | undefined> },
) {
  const atual = await lerConexao(db, workspaceId, provedor);
  const dados = { ...atual.dados, ...(mudancas.dados ?? {}) };
  const segredos: Record<string, string> = { ...atual.segredos };
  for (const [k, v] of Object.entries(mudancas.segredos ?? {})) if (v) segredos[k] = v;

  const pronta =
    provedor === "google_ads"
      ? Boolean(segredos.developer_token && segredos.client_id && segredos.client_secret && segredos.refresh_token && dados.cliente)
      : provedor === "tiktok"
        ? Boolean(segredos.access_token && dados.conta)
        : Boolean(segredos.token && dados.conta);

  const agora = new Date().toISOString();
  return db.from("conexoes").upsert({
    workspace_id: workspaceId,
    provedor,
    dados: {
      ...dados,
      // Só "tem ou não tem": os valores secretos nunca vão para a tela.
      tem_developer_token: Boolean(segredos.developer_token),
      tem_app_oauth: Boolean((segredos.client_id && segredos.client_secret) || (segredos.app_id && segredos.secret)),
      tem_autorizacao: Boolean(segredos.refresh_token || segredos.access_token),
    },
    segredo: Object.keys(segredos).length ? cifrar(segredos) : null,
    conectado_em: pronta ? agora : null,
    atualizado_em: agora,
    atualizado_por: usuarioId,
  });
}
