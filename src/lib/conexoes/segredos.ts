import { cifrar, decifrar } from "@/lib/cripto";
import { appGoogle, appMeta, appTikTok, developerTokenGoogle } from "./app";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;
export type Provedor = "google_ads" | "meta" | "tiktok" | "google_presenca" | "windsor";

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

  // As credenciais do app podem vir das variáveis da plataforma ou do que o workspace salvou.
  const pronta =
    provedor === "google_ads"
      ? Boolean(developerTokenGoogle(segredos) && appGoogle(segredos, dados.app_origem) && segredos.refresh_token && dados.cliente)
      : provedor === "tiktok"
        ? Boolean(segredos.access_token && dados.conta)
        : provedor === "google_presenca"
          ? Boolean(segredos.refresh_token && (dados.local || dados.site_gsc))
          : provedor === "windsor"
            ? Boolean(segredos.api_key)
            : Boolean(segredos.token && dados.conta);

  const agora = new Date().toISOString();
  return db.from("conexoes").upsert({
    workspace_id: workspaceId,
    provedor,
    dados: {
      ...dados,
      // Só "tem ou não tem": os valores secretos nunca vão para a tela.
      tem_developer_token: Boolean(provedor === "google_ads" ? developerTokenGoogle(segredos) : segredos.developer_token),
      tem_app_oauth: Boolean(
        provedor === "meta" ? appMeta() : provedor === "tiktok" ? appTikTok(segredos, dados.app_origem) : appGoogle(segredos, dados.app_origem),
      ),
      tem_autorizacao: Boolean(segredos.refresh_token || segredos.access_token),
    },
    segredo: Object.keys(segredos).length ? cifrar(segredos) : null,
    conectado_em: pronta ? agora : null,
    atualizado_em: agora,
    atualizado_por: usuarioId,
  });
}

/**
 * Marca a conexão como "precisa reconectar" (token vencido ou revogado na plataforma), sem tocar nos segredos.
 * A tela Conexões mostra o aviso e o botão para conectar de novo. Uma nova autorização limpa a marca.
 */
export async function marcarReconexao(db: Admin, workspaceId: string, provedor: Provedor, motivo: string): Promise<void> {
  const { data } = await db.from("conexoes").select("dados").eq("workspace_id", workspaceId).eq("provedor", provedor).maybeSingle();
  if (!data) return;
  const dados = { ...((data.dados as Record<string, unknown> | null) ?? {}), precisa_reconectar: true, motivo_reconexao: motivo.slice(0, 200) };
  await db.from("conexoes").update({ dados, atualizado_em: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("provedor", provedor);
}
