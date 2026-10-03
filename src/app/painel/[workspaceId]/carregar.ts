import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Papel } from "@/lib/trafego/acesso";

/**
 * Carrega o workspace da URL com a sessão do usuário.
 * Quem não é membro não encontra nada (RLS) e recebe "página não encontrada".
 */
export async function carregarWorkspace(workspaceId: string) {
  if (!z.uuid().safeParse(workspaceId).success) notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const [{ data: workspace }, { data: membro }] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle(),
    supabase.from("members").select("role").eq("workspace_id", workspaceId).eq("user_id", auth.user.id).maybeSingle(),
  ]);
  if (!workspace || !membro) notFound();

  return { supabase, user: auth.user, workspace, papel: membro.role as Papel };
}
