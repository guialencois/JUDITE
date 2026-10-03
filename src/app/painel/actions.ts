"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const workspaceSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export async function createWorkspace(formData: FormData) {
  const parsed = workspaceSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) redirect("/painel?erro=nome");

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  // O banco preenche o dono (created_by) e a regra de segurança (RLS) confere.
  const { error } = await supabase.from("workspaces").insert({ name: parsed.data.name });
  if (error) redirect("/painel?erro=criar");

  revalidatePath("/painel");
  redirect("/painel");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
