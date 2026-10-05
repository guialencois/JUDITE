"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { proporCampanha } from "@/lib/campanhas/propor";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";
import { executarAcao } from "@/lib/trafego/executar";
import { PLATAFORMAS, type Plataforma } from "@/lib/trafego/tipos";

const pagina = (ws: string, sufixo: string) => `/painel/${ws}/diretor-trafego?${sufixo}`;
const comMotivo = (codigo: string, motivo: string) => `erro=${codigo}&motivo=` + encodeURIComponent(motivo.slice(0, 200));
/** Intervalo mínimo entre propostas pedidas pelo botão (cada uma custa uma chamada à IA). */
const INTERVALO_MINIMO_MS = 60_000;

async function exigirGestor(ws: string) {
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel"));
  return acesso;
}

/** Pede à JUDITE uma proposta de campanha agora (ela escolhe o produto). Só grava um rascunho para avaliação. */
export async function proporAgora(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  const db = createAdminClient();

  const { data: recente } = await db.from("campanha_rascunhos").select("criado_em").eq("workspace_id", ws).eq("origem", "diretor")
    .order("criado_em", { ascending: false }).limit(1).maybeSingle();
  if (recente && Date.now() - new Date(recente.criado_em as string).getTime() < INTERVALO_MINIMO_MS) redirect(pagina(ws, "erro=recente"));

  const r = await proporCampanha(db, ws, acesso.userId);
  revalidatePath(`/painel/${ws}/diretor-trafego`);
  revalidatePath(`/painel/${ws}/campanhas`);
  redirect(pagina(ws, r.ok ? "aviso=proposta" : comMotivo("proposta", r.motivo)));
}

const decisaoSchema = z.object({ workspaceId: z.uuid(), acaoId: z.uuid(), decisao: z.enum(["aprovar", "dispensar"]) });
const ACOES = ["pausar", "ativar", "definir_orcamento"] as const;

/**
 * Aprova ou dispensa uma ação que a autonomia quis fazer mas ficou acima de algum limite.
 * Aprovar aplica a mudança pelo mesmo caminho do Gerenciador (executarAcao): quem clica é um humano
 * com papel de dono ou admin, e o clique vale como a confirmação dos limites.
 */
export async function decidirAcaoPendente(formData: FormData) {
  const parsed = decisaoSchema.safeParse({
    workspaceId: formData.get("workspaceId"), acaoId: formData.get("acaoId"), decisao: formData.get("decisao"),
  });
  if (!parsed.success) redirect("/painel");
  const { workspaceId: ws, acaoId, decisao } = parsed.data;
  const acesso = await exigirGestor(ws);
  const db = createAdminClient();

  // Reserva a linha primeiro (só passa quem ainda está aguardando): evita aplicar duas vezes com clique duplo.
  const { data: pendente, error } = await db.from("trafego_acoes")
    .update({ status: decisao === "aprovar" ? "aprovada" : "dispensada" })
    .eq("id", acaoId).eq("workspace_id", ws).eq("status", "aguardando_aprovacao").eq("origem", "automacao").in("acao", [...ACOES])
    .select("plataforma, entidade_id, entidade_nome, acao, valor_depois").maybeSingle();
  revalidatePath(`/painel/${ws}/diretor-trafego`);
  if (error) redirect(pagina(ws, "erro=migracao"));
  if (!pendente) redirect(pagina(ws, "erro=decisao"));
  if (decisao === "dispensar") redirect(pagina(ws, "aviso=dispensada"));

  const plataforma = PLATAFORMAS.find((p) => p === pendente.plataforma);
  const acao = ACOES.find((a) => a === pendente.acao);
  const valor = acao === "definir_orcamento" ? Number(pendente.valor_depois) : undefined;
  if (!plataforma || !acao || (acao === "definir_orcamento" && !(Number.isFinite(valor) && Number(valor) > 0))) {
    redirect(pagina(ws, comMotivo("execucao", "Os dados dessa ação estão incompletos. Refaça a mudança no Gerenciador.")));
  }

  const r = await executarAcao(db, {
    workspaceId: ws, origem: "painel", usuarioId: acesso.userId, plataforma: plataforma as Plataforma,
    entidadeId: pendente.entidade_id as string, entidadeNome: (pendente.entidade_nome as string | null) ?? undefined,
    acao, valorReais: valor, confirmado: true, observacao: "Ação proposta pela autonomia e aprovada por uma pessoa",
  });
  revalidatePath(`/painel/${ws}/trafego/gerenciador`);
  if (r.tipo === "aplicada") redirect(pagina(ws, "aviso=aplicada"));
  redirect(pagina(ws, comMotivo("execucao", r.tipo === "aguardando_aprovacao" ? r.motivo : r.erro)));
}
