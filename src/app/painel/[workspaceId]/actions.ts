"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Todas as escritas usam a sessão do usuário: o RLS do banco decide se ele pode.

const conviteSchema = z.object({
  workspaceId: z.uuid(),
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  role: z.enum(["admin", "member"]),
});

export async function convidar(formData: FormData) {
  const parsed = conviteSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  const base = `/painel/${String(formData.get("workspaceId"))}`;
  if (!parsed.success) redirect(`${base}?erro=convite`);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { error } = await supabase.from("convites").insert({
    workspace_id: parsed.data.workspaceId,
    email: parsed.data.email,
    role: parsed.data.role,
    convidado_por: auth.user.id,
  });
  if (error) redirect(`${base}?erro=convite`);

  revalidatePath(base);
  redirect(`${base}?aviso=convite`);
}

export async function cancelarConvite(formData: FormData) {
  const ids = z.object({ workspaceId: z.uuid(), conviteId: z.uuid() }).safeParse({
    workspaceId: formData.get("workspaceId"),
    conviteId: formData.get("conviteId"),
  });
  if (!ids.success) redirect("/painel");

  const supabase = await createClient();
  await supabase.from("convites").delete().eq("id", ids.data.conviteId).eq("workspace_id", ids.data.workspaceId);
  revalidatePath(`/painel/${ids.data.workspaceId}`);
}

const limitesSchema = z.object({
  workspaceId: z.uuid(),
  orcamento_max_sem_aprovacao: z.coerce.number().min(0).max(5000),
  aumento_max_por_vez_percent: z.coerce.number().min(0).max(100),
  custos_percent: z.coerce.number().min(0).max(100),
});

export async function salvarLimites(formData: FormData) {
  const parsed = limitesSchema.safeParse(Object.fromEntries(formData));
  const base = `/painel/${String(formData.get("workspaceId"))}`;
  if (!parsed.success) redirect(`${base}?erro=limites`);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { workspaceId, ...valores } = parsed.data;
  for (const [chave, valor] of Object.entries(valores)) {
    const { error, count } = await supabase
      .from("trafego_config")
      .update({ valor, atualizado_por: auth.user.id, atualizado_em: new Date().toISOString() }, { count: "exact" })
      .eq("workspace_id", workspaceId)
      .eq("chave", chave);
    if (error || count === 0) redirect(`${base}?erro=limites`);
  }

  revalidatePath(base);
  redirect(`${base}?aviso=limites`);
}
