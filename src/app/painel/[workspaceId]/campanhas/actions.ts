"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { gravarRascunho } from "@/lib/campanhas/gravar";
import { ativarRascunho, publicarRascunho } from "@/lib/campanhas/publicar";
import { rascunhoSchema } from "@/lib/campanhas/rascunho";
import { mudarEstado } from "@/lib/cmo/estados";
import { repositorioDeEstados } from "@/lib/cmo/estados-db";
import { criarCampanha } from "@/lib/cmo/servico";
import { exigirDono } from "@/lib/conexoes/acesso";
import { iaConfigurada } from "@/lib/ia";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";

const pagina = (ws: string, sufixo: string, tela = "campanhas") => `/painel/${ws}/${tela}?${sufixo}`;
/** As decisões também são tomadas na página Diretor de Tráfego: o formulário diz para onde voltar. */
const telaDeVolta = (formData: FormData) => (formData.get("voltar") === "diretor-trafego" ? "diretor-trafego" : "campanhas");

async function exigirGestor(ws: string) {
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel"));
  return acesso;
}

const numeroOuNulo = z.string().trim().transform((v) => (v === "" ? null : Number(v))).pipe(z.number().int().min(18).max(65).nullable());

export async function criarRascunho(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  const idades = z.object({ min: numeroOuNulo, max: numeroOuNulo }).safeParse({ min: formData.get("idadeMin") ?? "", max: formData.get("idadeMax") ?? "" });
  const parsed = rascunhoSchema.safeParse({
    plataforma: formData.get("plataforma"),
    nome: formData.get("nome") ?? "",
    objetivo: formData.get("objetivo"),
    orcamento_diario: Number(formData.get("orcamento") ?? 0),
    publico: {
      regiao: String(formData.get("regiao") ?? ""), interesses: String(formData.get("interesses") ?? ""),
      idade_min: idades.success ? idades.data.min : null, idade_max: idades.success ? idades.data.max : null,
    },
    produto_id: String(formData.get("produtoId") ?? "") || null,
    criativo_ids: formData.getAll("criativoIds").map(String).filter(Boolean),
    justificativa: String(formData.get("justificativa") ?? ""),
  });
  if (!parsed.success || !idades.success) redirect(pagina(ws, "erro=rascunho"));

  const salvo = await gravarRascunho(createAdminClient(), ws, acesso.userId, "painel", parsed.data);
  revalidatePath(`/painel/${ws}/campanhas`);
  redirect(pagina(ws, "erro" in salvo ? "erro=conferencia&motivo=" + encodeURIComponent(salvo.erro.slice(0, 200)) : "aviso=rascunho"));
}

/** Pede à CMO uma campanha para um produto cadastrado (o mesmo motor da página Diretor de Tráfego). */
export async function pedirRascunhoAoDiretor(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  if (!iaConfigurada()) redirect(pagina(ws, "erro=sem-chave"));
  const parsed = z.object({ produtoId: z.uuid(), orientacao: z.string().trim().max(300) })
    .safeParse({ produtoId: formData.get("produtoId"), orientacao: formData.get("orientacao") ?? "" });
  if (!parsed.success) redirect(pagina(ws, "erro=produto"));

  const db = createAdminClient();
  const { data: recente } = await db.from("campanha_rascunhos").select("criado_em").eq("workspace_id", ws).eq("origem", "diretor")
    .order("criado_em", { ascending: false }).limit(1).maybeSingle();
  if (recente && Date.now() - new Date(recente.criado_em as string).getTime() < 60_000) redirect(pagina(ws, "erro=recente"));

  const r = await criarCampanha(db, {
    workspaceId: ws, usuarioId: acesso.userId, modo: "automatico", produtoId: parsed.data.produtoId, observacao: parsed.data.orientacao || null,
  });
  revalidatePath(`/painel/${ws}/campanhas`);
  revalidatePath(`/painel/${ws}/diretor-trafego`);
  redirect(pagina(ws, r.ok ? "aviso=rascunho-ia" : "erro=ia&motivo=" + encodeURIComponent(r.motivo.slice(0, 200))));
}

const decisaoSchema = z.object({ workspaceId: z.uuid(), rascunhoId: z.uuid(), decisao: z.enum(["aprovar", "recusar", "ativar"]) });

/** Aprovar (cria a campanha PAUSADA), recusar ou ativar (segunda aprovação). SÓ O DONO. */
export async function decidirRascunho(formData: FormData) {
  const parsed = decisaoSchema.safeParse({
    workspaceId: formData.get("workspaceId"), rascunhoId: formData.get("rascunhoId"), decisao: formData.get("decisao"),
  });
  if (!parsed.success) redirect("/painel");
  const { workspaceId: ws, rascunhoId, decisao } = parsed.data;
  const tela = telaDeVolta(formData);
  const dono = await exigirDono(ws);
  if (!dono) redirect(pagina(ws, "erro=so-dono", tela));
  const db = createAdminClient();
  const revalidar = () => {
    revalidatePath(`/painel/${ws}/campanhas`);
    revalidatePath(`/painel/${ws}/diretor-trafego`);
  };

  if (decisao === "recusar") {
    const recusa = await mudarEstado(repositorioDeEstados(db), {
      workspaceId: ws, rascunhoId, de: "aguardando_aprovacao", para: "recusada", ator: "pessoa", usuarioId: dono.userId,
      motivo: "Recusada pelo dono. Nada foi criado.", campos: { decidido_por: dono.userId, decidido_em: new Date().toISOString() },
    });
    revalidar();
    redirect(pagina(ws, recusa.ok ? "aviso=recusada" : "erro=plataforma&motivo=" + encodeURIComponent(recusa.motivo), tela));
  }

  const r = decisao === "aprovar" ? await publicarRascunho(db, ws, rascunhoId, dono.userId) : await ativarRascunho(db, ws, rascunhoId, dono.userId);
  revalidar();
  redirect(pagina(ws, r.ok
    ? `aviso=${decisao === "aprovar" ? "publicada" : "ativada"}${r.simulada ? "-simulada" : ""}`
    : "erro=plataforma&motivo=" + encodeURIComponent(r.motivo.slice(0, 200)), tela));
}
