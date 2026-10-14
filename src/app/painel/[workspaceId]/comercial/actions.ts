"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hojeEmBrasilia, mesValido } from "@/lib/trafego/mes";

// Todas as escritas usam a sessão do usuário: o RLS do banco decide se ele pode
// (membros registram vendas; dono ou admin corrigem, apagam e definem metas).

const pagina = (ws: string, sufixo: string) => `/painel/${ws}/comercial?${sufixo}`;
const textoOpcional = (max: number) => z.string().trim().max(max).transform((v) => v || null);

const vendaSchema = z.object({
  workspaceId: z.uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  produto: z.string().trim().min(1).max(120),
  pessoas: z.coerce.number().int().min(1).max(1000),
  valor: z.coerce.number().min(0).max(10_000_000),
  origem: textoOpcional(80),
  campanhaId: z.string().trim().regex(/^[A-Za-z0-9_-]{0,64}$/).transform((v) => v || null),
  observacao: textoOpcional(500),
});

export async function registrarVenda(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const parsed = vendaSchema.safeParse({
    workspaceId: ws,
    data: formData.get("data") ?? "",
    produto: formData.get("produto") ?? "",
    pessoas: formData.get("pessoas") ?? "1",
    valor: formData.get("valor") ?? "",
    origem: formData.get("origem") ?? "",
    campanhaId: formData.get("campanhaId") ?? "",
    observacao: formData.get("observacao") ?? "",
  });
  if (!parsed.success) redirect(pagina(ws, "erro=venda"));
  // Venda com data no futuro é quase sempre erro de digitação.
  if (parsed.data.data > hojeEmBrasilia()) redirect(pagina(ws, "erro=venda-futura"));

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { error } = await supabase.from("trafego_vendas").insert({
    workspace_id: parsed.data.workspaceId,
    data: parsed.data.data,
    produto: parsed.data.produto,
    pessoas: parsed.data.pessoas,
    valor: parsed.data.valor,
    origem: parsed.data.origem,
    campanha_id: parsed.data.campanhaId,
    observacao: parsed.data.observacao,
    criado_por: auth.user.id,
  });
  if (error) redirect(pagina(ws, "erro=venda"));

  revalidatePath(`/painel/${ws}/comercial`);
  redirect(pagina(ws, `aviso=venda&mes=${parsed.data.data.slice(0, 7)}`));
}

export async function apagarVenda(formData: FormData) {
  const ids = z.object({ workspaceId: z.uuid(), vendaId: z.uuid() }).safeParse({
    workspaceId: formData.get("workspaceId"),
    vendaId: formData.get("vendaId"),
  });
  if (!ids.success) redirect("/painel");
  const mes = formData.get("mes");
  const supabase = await createClient();
  const { error, count } = await supabase.from("trafego_vendas").delete({ count: "exact" })
    .eq("id", ids.data.vendaId).eq("workspace_id", ids.data.workspaceId);
  const sufixo = (error || !count ? "erro=apagar" : "aviso=apagada") + (mesValido(mes) ? `&mes=${mes}` : "");
  revalidatePath(`/painel/${ids.data.workspaceId}/comercial`);
  redirect(pagina(ids.data.workspaceId, sufixo));
}

const METRICAS = ["faturamento", "investimento", "compras", "roas", "cpa"] as const;
const alvoSchema = z.string().trim().transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
  .pipe(z.number().min(0).max(100_000_000).nullable());

export async function salvarMetas(formData: FormData) {
  const ws = String(formData.get("workspaceId"));
  const mes = formData.get("mes");
  if (!z.uuid().safeParse(ws).success || !mesValido(mes)) redirect("/painel");

  const supabase = await createClient();
  for (const metrica of METRICAS) {
    const alvo = alvoSchema.safeParse(String(formData.get(metrica) ?? ""));
    if (!alvo.success) redirect(pagina(ws, `erro=metas&mes=${mes}`));
    const filtro = { workspace_id: ws, mes: `${mes}-01`, metrica };
    // Campo vazio (ou zero) = sem meta para essa métrica neste mês.
    const { error } = alvo.data === null || alvo.data === 0
      ? await supabase.from("trafego_metas").delete().match(filtro)
      : await supabase.from("trafego_metas").upsert({ ...filtro, alvo: alvo.data }, { onConflict: "workspace_id,mes,metrica" });
    if (error) redirect(pagina(ws, `erro=metas&mes=${mes}`));
  }
  revalidatePath(`/painel/${ws}/comercial`);
  redirect(pagina(ws, `aviso=metas&mes=${mes}`));
}
