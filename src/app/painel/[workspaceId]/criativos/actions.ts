"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { gerarVariacoes } from "@/lib/criativos/gerar";
import { ErroIA, iaConfigurada } from "@/lib/diretor/claude";
import { createClient } from "@/lib/supabase/server";
import { papelNoWorkspace, podeAgir } from "@/lib/trafego/acesso";

// Todas as escritas usam a sessão do usuário: o RLS do banco só deixa dono ou admin gravar.

const pagina = (ws: string, sufixo: string) => `/painel/${ws}/criativos?${sufixo}`;
const opcional = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const idOpcional = z.string().transform((v) => v || null).pipe(z.uuid().nullable());
const plataformaOpcional = z.string().transform((v) => v || null).pipe(z.enum(["google_ads", "facebook", "tiktok"]).nullable());

async function exigirGestor(ws: string) {
  if (!z.uuid().safeParse(ws).success) redirect("/painel");
  const acesso = await papelNoWorkspace(ws);
  if (!acesso) redirect("/login");
  if (!podeAgir(acesso.papel)) redirect(pagina(ws, "erro=papel"));
  return acesso;
}

const produtoSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  descricao: opcional(2000),
  preco: z.string().trim().transform((v) => (v === "" ? null : Number(v))).pipe(z.number().min(0).max(10_000_000).nullable()),
  detalhes: opcional(2000),
  publico: opcional(500),
  link: opcional(300),
});

export async function salvarProduto(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  const parsed = produtoSchema.safeParse({
    nome: formData.get("nome") ?? "", descricao: formData.get("descricao") ?? "", preco: formData.get("preco") ?? "",
    detalhes: formData.get("detalhes") ?? "", publico: formData.get("publico") ?? "", link: formData.get("link") ?? "",
  });
  if (!parsed.success) redirect(pagina(ws, "erro=produto"));
  const supabase = await createClient();
  const { error } = await supabase.from("produtos").insert({ workspace_id: ws, criado_por: acesso.userId, ...parsed.data });
  revalidatePath(`/painel/${ws}/criativos`);
  redirect(pagina(ws, error ? "erro=salvar" : "aviso=produto"));
}

export async function removerProduto(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  await exigirGestor(ws);
  const id = z.uuid().safeParse(formData.get("produtoId"));
  if (!id.success) redirect(pagina(ws, "erro=salvar"));
  const supabase = await createClient();
  // Desativa em vez de apagar: os criativos e experimentos antigos continuam com o histórico.
  await supabase.from("produtos").update({ ativo: false }).eq("id", id.data).eq("workspace_id", ws);
  revalidatePath(`/painel/${ws}/criativos`);
  redirect(pagina(ws, "aviso=produto-removido"));
}

const geracaoSchema = z.object({
  produtoId: z.uuid(),
  plataforma: plataformaOpcional,
  quantidade: z.coerce.number().int().min(2).max(6),
  orientacao: opcional(300),
});

/** Pede variações à IA para um produto cadastrado e salva as que passarem na conferência, como rascunho. */
export async function gerar(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  if (!iaConfigurada()) redirect(pagina(ws, "erro=sem-chave"));
  const parsed = geracaoSchema.safeParse({
    produtoId: formData.get("produtoId"), plataforma: formData.get("plataforma") ?? "",
    quantidade: formData.get("quantidade") ?? "4", orientacao: formData.get("orientacao") ?? "",
  });
  if (!parsed.success) redirect(pagina(ws, "erro=geracao-dados"));

  const supabase = await createClient();
  const [{ data: produto }, { data: aprendizados }, { data: recente }] = await Promise.all([
    supabase.from("produtos").select("id, nome, descricao, preco, detalhes, publico, link").eq("id", parsed.data.produtoId).eq("workspace_id", ws).maybeSingle(),
    supabase.from("aprendizados").select("texto").eq("workspace_id", ws).order("criado_em", { ascending: false }).limit(10),
    supabase.from("criativos").select("criado_em").eq("workspace_id", ws).eq("origem", "ia").order("criado_em", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!produto) redirect(pagina(ws, "erro=geracao-dados"));
  // Cada geração custa uma chamada à IA: evita clique repetido.
  if (recente && Date.now() - new Date(recente.criado_em as string).getTime() < 20_000) redirect(pagina(ws, "erro=recente"));

  let resultado: Awaited<ReturnType<typeof gerarVariacoes>>;
  try {
    resultado = await gerarVariacoes({
      produto: {
        nome: produto.nome as string, descricao: (produto.descricao as string | null) ?? null,
        preco: produto.preco === null || produto.preco === undefined ? null : Number(produto.preco),
        detalhes: (produto.detalhes as string | null) ?? null, publico: (produto.publico as string | null) ?? null,
        link: (produto.link as string | null) ?? null,
      },
      plataforma: parsed.data.plataforma,
      quantidade: parsed.data.quantidade,
      orientacao: parsed.data.orientacao,
      aprendizados: (aprendizados ?? []).map((a) => a.texto as string),
    });
  } catch (erro) {
    const motivo = erro instanceof ErroIA ? erro.message : "Erro inesperado ao falar com a IA.";
    redirect(pagina(ws, "erro=ia&motivo=" + encodeURIComponent(motivo.slice(0, 200))));
  }

  const lote = randomUUID();
  if (resultado.aceitas.length) {
    const { error } = await supabase.from("criativos").insert(resultado.aceitas.map((v) => ({
      workspace_id: ws, produto_id: produto.id, criado_por: acesso.userId, origem: "ia", lote,
      formato: v.formato, plataforma: parsed.data.plataforma,
      titulo: v.titulo.slice(0, 200), descricao: v.descricao.slice(0, 500), cta: v.cta.slice(0, 80), texto: v.texto.slice(0, 3000),
      status: "rascunho",
    })));
    if (error) redirect(pagina(ws, "erro=salvar"));
  }
  revalidatePath(`/painel/${ws}/criativos`);
  redirect(pagina(ws, `aviso=geradas&salvas=${resultado.aceitas.length}&barradas=${resultado.descartadas.length}`));
}

export async function mudarStatusCriativo(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  await exigirGestor(ws);
  const parsed = z.object({ criativoId: z.uuid(), status: z.enum(["aprovado", "arquivado", "rascunho"]) })
    .safeParse({ criativoId: formData.get("criativoId"), status: formData.get("status") });
  if (!parsed.success) redirect(pagina(ws, "erro=salvar"));
  const supabase = await createClient();
  await supabase.from("criativos").update({ status: parsed.data.status }).eq("id", parsed.data.criativoId).eq("workspace_id", ws);
  revalidatePath(`/painel/${ws}/criativos`);
  redirect(pagina(ws, "aviso=criativo"));
}

const experimentoSchema = z.object({
  nome: z.string().trim().min(1).max(160),
  hipotese: opcional(500),
  produtoId: idOpcional,
  criativoA: idOpcional,
  criativoB: idOpcional,
  plataforma: plataformaOpcional,
  metrica: z.enum(["ctr", "cpc", "conversoes", "whatsapp", "vendas"]),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function criarExperimento(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  const parsed = experimentoSchema.safeParse({
    nome: formData.get("nome") ?? "", hipotese: formData.get("hipotese") ?? "", produtoId: formData.get("produtoId") ?? "",
    criativoA: formData.get("criativoA") ?? "", criativoB: formData.get("criativoB") ?? "", plataforma: formData.get("plataforma") ?? "",
    metrica: formData.get("metrica"), inicio: formData.get("inicio") ?? "",
  });
  if (!parsed.success) redirect(pagina(ws, "erro=experimento"));
  const supabase = await createClient();

  let hipoteseId: string | null = null;
  if (parsed.data.hipotese) {
    const { data, error } = await supabase.from("hipoteses")
      .insert({ workspace_id: ws, texto: parsed.data.hipotese, criado_por: acesso.userId }).select("id").single();
    if (error) redirect(pagina(ws, "erro=salvar"));
    hipoteseId = data.id as string;
  }
  const { error } = await supabase.from("experimentos").insert({
    workspace_id: ws, criado_por: acesso.userId, hipotese_id: hipoteseId, nome: parsed.data.nome, produto_id: parsed.data.produtoId,
    criativo_a: parsed.data.criativoA, criativo_b: parsed.data.criativoB, plataforma: parsed.data.plataforma,
    metrica: parsed.data.metrica, inicio: parsed.data.inicio, status: "rodando",
  });
  revalidatePath(`/painel/${ws}/criativos`);
  redirect(pagina(ws, error ? "erro=salvar" : "aviso=experimento"));
}

const numeroOpcional = z.string().trim().transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
  .pipe(z.number().min(0).max(1_000_000_000).nullable());

const conclusaoSchema = z.object({
  experimentoId: z.uuid(),
  resultadoA: numeroOpcional,
  resultadoB: numeroOpcional,
  vencedor: z.enum(["a", "b", "empate"]),
  hipotese: z.enum(["confirmada", "refutada", "inconclusiva"]),
  conclusao: z.string().trim().min(1).max(1000),
  categoria: z.enum(["criativo", "publico", "oferta", "canal", "site", "outro"]),
});

/** Fecha o experimento com os números digitados por uma pessoa e guarda a conclusão como aprendizado. */
export async function concluirExperimento(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  const parsed = conclusaoSchema.safeParse({
    experimentoId: formData.get("experimentoId"), resultadoA: formData.get("resultadoA") ?? "", resultadoB: formData.get("resultadoB") ?? "",
    vencedor: formData.get("vencedor"), hipotese: formData.get("hipotese"), conclusao: formData.get("conclusao") ?? "",
    categoria: formData.get("categoria"),
  });
  if (!parsed.success) redirect(pagina(ws, "erro=conclusao"));
  const supabase = await createClient();
  const hoje = new Date().toISOString().slice(0, 10);

  const { data: experimento, error } = await supabase.from("experimentos")
    .update({
      status: "concluido", fim: hoje, resultado_a: parsed.data.resultadoA, resultado_b: parsed.data.resultadoB,
      vencedor: parsed.data.vencedor, conclusao: parsed.data.conclusao,
    })
    .eq("id", parsed.data.experimentoId).eq("workspace_id", ws).eq("status", "rodando")
    .select("id, hipotese_id").maybeSingle();
  if (error || !experimento) redirect(pagina(ws, "erro=conclusao"));

  if (experimento.hipotese_id) {
    await supabase.from("hipoteses").update({ status: parsed.data.hipotese }).eq("id", experimento.hipotese_id).eq("workspace_id", ws);
  }
  await supabase.from("aprendizados").insert({
    workspace_id: ws, experimento_id: experimento.id, categoria: parsed.data.categoria, texto: parsed.data.conclusao, criado_por: acesso.userId,
  });
  revalidatePath(`/painel/${ws}/criativos`);
  redirect(pagina(ws, "aviso=concluido"));
}

export async function adicionarAprendizado(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const acesso = await exigirGestor(ws);
  const parsed = z.object({
    texto: z.string().trim().min(1).max(1000),
    categoria: z.enum(["criativo", "publico", "oferta", "canal", "site", "outro"]),
  }).safeParse({ texto: formData.get("texto") ?? "", categoria: formData.get("categoria") });
  if (!parsed.success) redirect(pagina(ws, "erro=aprendizado"));
  const supabase = await createClient();
  const { error } = await supabase.from("aprendizados").insert({ workspace_id: ws, criado_por: acesso.userId, ...parsed.data });
  revalidatePath(`/painel/${ws}/criativos`);
  redirect(pagina(ws, error ? "erro=salvar" : "aviso=aprendizado"));
}
