"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigirDono } from "@/lib/conexoes/acesso";
import { gravarConexao } from "@/lib/conexoes/segredos";
import {
  abrirPresenca, avaliacaoValida, contaValida, listarLocais, listarSitesGsc, localValido, publicarPost, responderAvaliacao, siteGscValido,
} from "@/lib/presenca/google";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";

const pagina = (ws: string, sufixo: string) => `/painel/${ws}/presenca?${sufixo}`;

const escolhaSchema = z.object({
  workspaceId: z.uuid(),
  // "accounts/1|locations/2" (ou vazio para não usar o Perfil da Empresa)
  perfil: z.string().max(100),
  siteGsc: z.string().max(200),
});

/** O dono escolhe qual perfil e qual propriedade do Search Console pertencem a este workspace. */
export async function salvarEscolha(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const parsed = escolhaSchema.safeParse({ workspaceId: ws, perfil: formData.get("perfil") ?? "", siteGsc: formData.get("siteGsc") ?? "" });
  if (!parsed.success) redirect(pagina(ws, "erro=escolha"));
  const dono = await exigirDono(parsed.data.workspaceId);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const [conta, local] = parsed.data.perfil.split("|");
  const temPerfil = parsed.data.perfil !== "";
  if (temPerfil && !(contaValida(conta) && localValido(local))) redirect(pagina(ws, "erro=escolha"));
  const temSite = parsed.data.siteGsc !== "";
  if (temSite && !siteGscValido(parsed.data.siteGsc)) redirect(pagina(ws, "erro=escolha"));

  // Só aceita o que a conta autorizada realmente administra (ninguém "adota" o perfil de outra empresa).
  const db = createAdminClient();
  const aberto = await abrirPresenca(db, ws);
  if (!aberto.ok) redirect(pagina(ws, "erro=conexao"));
  try {
    if (temPerfil) {
      const locais = await listarLocais(aberto.acesso.token);
      if (!locais.some((l) => l.conta === conta && l.local === local)) redirect(pagina(ws, "erro=escolha"));
    }
    if (temSite) {
      const sites = await listarSitesGsc(aberto.acesso.token);
      if (!sites.includes(parsed.data.siteGsc)) redirect(pagina(ws, "erro=escolha"));
    }
  } catch (erro) {
    // redirect() funciona lançando um erro especial: deixa passar.
    if (erro && typeof erro === "object" && "digest" in erro) throw erro;
    redirect(pagina(ws, "erro=google"));
  }

  const { error } = await gravarConexao(db, ws, "google_presenca", dono.userId, {
    dados: { conta: temPerfil ? conta : null, local: temPerfil ? local : null, site_gsc: temSite ? parsed.data.siteGsc : null },
  });
  if (error) redirect(pagina(ws, "erro=salvar"));
  revalidatePath(`/painel/${ws}/presenca`);
  redirect(pagina(ws, "aviso=escolha"));
}

const propostaSchema = z.object({
  workspaceId: z.uuid(),
  tipo: z.enum(["responder_avaliacao", "publicar_post"]),
  alvo: z.string().max(300),
  contexto: z.string().max(1000),
  conteudo: z.string().trim().min(1).max(1500),
});

/** Dono ou admin escreve o rascunho. Ele NÃO vai para o Google: fica aguardando a aprovação do dono. */
export async function proporAcao(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const parsed = propostaSchema.safeParse({
    workspaceId: ws, tipo: formData.get("tipo"), alvo: formData.get("alvo") ?? "",
    contexto: formData.get("contexto") ?? "", conteudo: formData.get("conteudo") ?? "",
  });
  if (!parsed.success) redirect(pagina(ws, "erro=rascunho"));
  const acesso = await papelNoWorkspace(parsed.data.workspaceId);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel"));
  if (parsed.data.tipo === "responder_avaliacao" && !avaliacaoValida(parsed.data.alvo)) redirect(pagina(ws, "erro=rascunho"));

  const { error } = await createAdminClient().from("presenca_acoes").insert({
    workspace_id: ws,
    criado_por: acesso.userId,
    origem: "painel",
    tipo: parsed.data.tipo,
    alvo: parsed.data.tipo === "responder_avaliacao" ? parsed.data.alvo : null,
    contexto: parsed.data.contexto || null,
    conteudo: parsed.data.conteudo,
    status: "aguardando_aprovacao",
  });
  revalidatePath(`/painel/${ws}/presenca`);
  redirect(pagina(ws, error ? "erro=salvar" : "aviso=rascunho"));
}

const decisaoSchema = z.object({ workspaceId: z.uuid(), acaoId: z.uuid(), decisao: z.enum(["aprovar", "recusar"]) });

/** SÓ O DONO aprova. Aprovar publica no Google de verdade; recusar só registra. */
export async function decidirAcao(formData: FormData) {
  const parsed = decisaoSchema.safeParse({
    workspaceId: formData.get("workspaceId"), acaoId: formData.get("acaoId"), decisao: formData.get("decisao"),
  });
  if (!parsed.success) redirect("/painel");
  const { workspaceId: ws, acaoId, decisao } = parsed.data;
  const dono = await exigirDono(ws);
  if (!dono) redirect(pagina(ws, "erro=so-dono"));

  const db = createAdminClient();
  const agora = new Date().toISOString();

  if (decisao === "recusar") {
    await db.from("presenca_acoes").update({ status: "recusada", decidido_por: dono.userId, decidido_em: agora })
      .eq("id", acaoId).eq("workspace_id", ws).eq("status", "aguardando_aprovacao");
    revalidatePath(`/painel/${ws}/presenca`);
    redirect(pagina(ws, "aviso=recusada"));
  }

  const { data: acao } = await db.from("presenca_acoes").select("tipo, alvo, conteudo")
    .eq("id", acaoId).eq("workspace_id", ws).eq("status", "aguardando_aprovacao").maybeSingle();
  if (!acao) redirect(pagina(ws, "erro=decisao"));

  const aberto = await abrirPresenca(db, ws);
  let erro: string | null = aberto.ok ? null : aberto.motivo;
  if (aberto.ok) {
    try {
      if (acao.tipo === "responder_avaliacao") await responderAvaliacao(aberto.acesso, acao.alvo as string, acao.conteudo as string);
      else await publicarPost(aberto.acesso, acao.conteudo as string);
    } catch (e) {
      erro = e instanceof Error ? e.message : "O Google recusou a publicação.";
    }
  }
  await db.from("presenca_acoes").update({
    status: erro ? "erro" : "publicada", decidido_por: dono.userId, decidido_em: agora,
    resultado: erro ? erro.slice(0, 500) : "Publicado no Google.",
  }).eq("id", acaoId).eq("workspace_id", ws).eq("status", "aguardando_aprovacao");
  revalidatePath(`/painel/${ws}/presenca`);
  redirect(pagina(ws, erro ? "erro=publicar" : "aviso=publicada"));
}
