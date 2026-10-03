"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Escritas com a sessão do usuário: o RLS só deixa dono ou admin.
const dominioSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
  .pipe(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/));

export async function cadastrarSite(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const parsed = z.object({ workspaceId: z.uuid(), dominio: dominioSchema }).safeParse({
    workspaceId: ws,
    dominio: formData.get("dominio") ?? "",
  });
  if (!parsed.success) redirect(`/painel/${ws}/site?erro=dominio`);

  const supabase = await createClient();
  const { error } = await supabase.from("sites").insert({
    workspace_id: parsed.data.workspaceId,
    dominio: parsed.data.dominio,
  });
  if (error) redirect(`/painel/${ws}/site?erro=salvar`);
  revalidatePath(`/painel/${ws}/site`);
  redirect(`/painel/${ws}/site`);
}

export async function removerSite(formData: FormData) {
  const ids = z.object({ workspaceId: z.uuid(), siteId: z.uuid() }).safeParse({
    workspaceId: formData.get("workspaceId"),
    siteId: formData.get("siteId"),
  });
  if (!ids.success) redirect("/painel");
  const supabase = await createClient();
  await supabase.from("sites").delete().eq("id", ids.data.siteId).eq("workspace_id", ids.data.workspaceId);
  revalidatePath(`/painel/${ids.data.workspaceId}/site`);
  redirect(`/painel/${ids.data.workspaceId}/site`);
}
