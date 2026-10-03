"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(72),
});

function readCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

export async function login(formData: FormData) {
  const parsed = readCredentials(formData);
  if (!parsed.success) redirect("/login?erro=dados");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  // Mensagem genérica: não revela se o e-mail existe ou não.
  if (error) redirect("/login?erro=credenciais");

  redirect("/painel");
}

export async function signup(formData: FormData) {
  const parsed = readCredentials(formData);
  if (!parsed.success) redirect("/login?erro=dados");

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });

  if (error) redirect("/login?erro=cadastro");

  redirect("/login?aviso=confirme-email");
}
