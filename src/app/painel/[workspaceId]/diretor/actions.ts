"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { gerarRelatorio } from "@/lib/diretor/gerar";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";

const pagina = (ws: string, sufixo: string) => `/painel/${ws}/diretor?${sufixo}`;
/** Intervalo mínimo entre relatórios pedidos pelo botão (cada um custa uma chamada à IA). */
const INTERVALO_MINIMO_MS = 10 * 60 * 1000;

export async function gerarAgora(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel"));

  const db = createAdminClient();
  const { data: ultimo } = await db.from("diretor_relatorios").select("criado_em")
    .eq("workspace_id", ws).eq("status", "ok").order("criado_em", { ascending: false }).limit(1).maybeSingle();
  if (ultimo && Date.now() - new Date(ultimo.criado_em as string).getTime() < INTERVALO_MINIMO_MS) {
    redirect(pagina(ws, "erro=recente"));
  }

  const r = await gerarRelatorio(db, ws, "manual", acesso.userId);
  revalidatePath(`/painel/${ws}/diretor`);
  redirect(pagina(ws, r.ok ? "aviso=gerado" : "erro=geracao"));
}

const decisaoSchema = z.object({
  workspaceId: z.uuid(),
  recomendacaoId: z.uuid(),
  decisao: z.enum(["aprovar", "recusar"]),
});

/**
 * Aprovar ou recusar uma recomendação. Nesta versão aprovar só registra a decisão:
 * o Diretor v1 não executa nada. A mudança de verdade é feita pelo humano no Gerenciador.
 */
export async function decidir(formData: FormData) {
  const parsed = decisaoSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    recomendacaoId: formData.get("recomendacaoId"),
    decisao: formData.get("decisao"),
  });
  if (!parsed.success) redirect("/painel");
  const { workspaceId: ws, recomendacaoId, decisao } = parsed.data;
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel"));

  const { error, count } = await createAdminClient().from("diretor_recomendacoes")
    .update({
      status: decisao === "aprovar" ? "aprovada" : "recusada",
      decidido_por: acesso.userId,
      decidido_em: new Date().toISOString(),
    }, { count: "exact" })
    .eq("id", recomendacaoId).eq("workspace_id", ws).eq("status", "proposta");
  revalidatePath(`/painel/${ws}/diretor`);
  redirect(pagina(ws, error || !count ? "erro=decisao" : decisao === "aprovar" ? "aviso=aprovada" : "aviso=recusada"));
}
