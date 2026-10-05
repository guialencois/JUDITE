"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { gerarRelatorio } from "@/lib/diretor/gerar";
import { executarAcao } from "@/lib/trafego/executar";
import type { Plataforma } from "@/lib/trafego/tipos";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";

const pagina = (ws: string, sufixo: string, tela = "diretor") => `/painel/${ws}/${tela}?${sufixo}`;
/** As decisões também são tomadas na página Diretor de Tráfego: o formulário diz para onde voltar. */
const telaDeVolta = (formData: FormData) => (formData.get("voltar") === "diretor-trafego" ? "diretor-trafego" : "diretor");
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

const ACAO_DA_RECOMENDACAO: Record<string, "pausar" | "ativar" | "definir_orcamento"> = {
  pausar_campanha: "pausar", ativar_campanha: "ativar", ajustar_orcamento: "definir_orcamento",
};

/**
 * Aprovar ou recusar uma recomendação.
 * Recomendações de verba (pausar, ativar, ajustar orçamento) são APLICADAS na aprovação, pelo mesmo
 * caminho do Gerenciador (executarAcao): quem aprova é um humano com papel de dono ou admin, e o clique
 * vale como a confirmação dos limites. As outras (site, criativo, perfil...) só registram a decisão.
 */
export async function decidir(formData: FormData) {
  const parsed = decisaoSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    recomendacaoId: formData.get("recomendacaoId"),
    decisao: formData.get("decisao"),
  });
  if (!parsed.success) redirect("/painel");
  const { workspaceId: ws, recomendacaoId, decisao } = parsed.data;
  const tela = telaDeVolta(formData);
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel", tela));

  const db = createAdminClient();
  const decidido = { decidido_por: acesso.userId, decidido_em: new Date().toISOString() };
  // Reserva a recomendação primeiro (só passa quem ainda está "proposta"): evita aplicar duas vezes com clique duplo.
  const { data: rec } = await db.from("diretor_recomendacoes")
    .update({ status: decisao === "aprovar" ? "aprovada" : "recusada", ...decidido })
    .eq("id", recomendacaoId).eq("workspace_id", ws).eq("status", "proposta")
    .select("tipo, titulo, plataforma, campanha_id, valor_sugerido").maybeSingle();
  revalidatePath(`/painel/${ws}/diretor`);
  revalidatePath(`/painel/${ws}/diretor-trafego`);
  if (!rec) redirect(pagina(ws, "erro=decisao", tela));
  if (decisao === "recusar") redirect(pagina(ws, "aviso=recusada", tela));

  const acao = ACAO_DA_RECOMENDACAO[rec.tipo as string];
  if (!acao || !rec.plataforma || !rec.campanha_id) redirect(pagina(ws, "aviso=aprovada", tela));

  const r = await executarAcao(db, {
    workspaceId: ws, origem: "painel", usuarioId: acesso.userId, plataforma: rec.plataforma as Plataforma,
    entidadeId: rec.campanha_id as string, acao, valorReais: rec.valor_sugerido === null ? undefined : Number(rec.valor_sugerido),
    confirmado: true, observacao: "Recomendação do Diretor aprovada",
  });
  const resultado = r.tipo === "aplicada" ? "Aplicada na plataforma." : r.tipo === "aguardando_aprovacao" ? r.motivo : r.erro;
  await db.from("diretor_recomendacoes")
    .update({ status: r.tipo === "aplicada" ? "executada" : "aprovada", resultado: resultado.slice(0, 500) })
    .eq("id", recomendacaoId).eq("workspace_id", ws);
  redirect(pagina(ws, r.tipo === "aplicada" ? "aviso=executada" : "erro=execucao", tela));
}

/** Liga a autonomia. SÓ O DONO, e só marcando a caixa de confirmação. */
export async function ligarAutonomia(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const tela = telaDeVolta(formData);
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const dono = await exigirDono(ws);
  if (!dono) redirect(pagina(ws, "erro=so-dono", tela));
  if (formData.get("ciente") !== "sim") redirect(pagina(ws, "erro=ciente", tela));
  const agora = new Date().toISOString();
  const { error } = await createAdminClient().from("autonomia")
    .upsert({ workspace_id: ws, ligada: true, atualizado_em: agora, atualizado_por: dono.userId, ligada_em: agora }, { onConflict: "workspace_id" });
  revalidatePath(`/painel/${ws}/diretor`);
  revalidatePath(`/painel/${ws}/diretor-trafego`);
  redirect(pagina(ws, error ? "erro=autonomia" : "aviso=autonomia-ligada", tela));
}

/** "Parar tudo": desliga a autonomia na hora. Dono ou admin (parar é sempre permitido a quem gerencia). */
export async function pararTudo(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const tela = telaDeVolta(formData);
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel", tela));
  const agora = new Date().toISOString();
  const { error } = await createAdminClient().from("autonomia")
    .upsert({ workspace_id: ws, ligada: false, atualizado_em: agora, atualizado_por: acesso.userId, desligada_em: agora }, { onConflict: "workspace_id" });
  revalidatePath(`/painel/${ws}/diretor`);
  revalidatePath(`/painel/${ws}/diretor-trafego`);
  redirect(pagina(ws, error ? "erro=autonomia" : "aviso=autonomia-desligada", tela));
}
