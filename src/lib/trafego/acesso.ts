import { createClient } from "@/lib/supabase/server";

export type Papel = "owner" | "admin" | "member";

/**
 * Confere, com a sessão do usuário, se ele está logado e tem um dos papéis no workspace.
 * A leitura passa pelo RLS: quem não é membro simplesmente não encontra a linha.
 */
export async function papelNoWorkspace(workspaceId: string): Promise<{ userId: string; papel: Papel } | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!data) return null;
  return { userId: auth.user.id, papel: data.role as Papel };
}

export const podeAgir = (papel: Papel) => papel === "owner" || papel === "admin";
