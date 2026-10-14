import type { createAdminClient } from "@/lib/supabase/admin";
import type { Plataforma } from "@/lib/trafego/tipos";

type Admin = ReturnType<typeof createAdminClient>;

/** Liga a conta de anúncios ao workspace, sem deixar um workspace "tomar" a conta de outro. SOMENTE no servidor. */
export async function registrarConta(db: Admin, workspaceId: string, plataforma: Plataforma, conta: string, nome: string | null) {
  await db.from("trafego_contas").upsert(
    { workspace_id: workspaceId, plataforma, conta_externa: conta, nome, ativo: true },
    { onConflict: "plataforma,conta_externa", ignoreDuplicates: true },
  );
  const { data } = await db
    .from("trafego_contas")
    .select("workspace_id")
    .eq("plataforma", plataforma)
    .eq("conta_externa", conta)
    .maybeSingle();
  return data?.workspace_id === workspaceId;
}
