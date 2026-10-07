/**
 * Sincronização: lê as plataformas (pelo provedor nativo de cada uma) e grava no Supabase.
 * O provedor é escolhido por workspace, conforme a conexão salva na página Conexões.
 *
 *   GET  -> cron da Vercel, uma vez por dia: sincroniza todos os workspaces.
 *   POST -> botão "Sincronizar dados": sincroniza só o workspace do usuário logado.
 *           Corpo: { "workspaceId": "...", "dias": 60 }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { provedorDoWorkspace } from "@/lib/anuncios/provedor";
import { createAdminClient } from "@/lib/supabase/admin";
import { papelNoWorkspace } from "@/lib/trafego/acesso";
import { ehChamadaDoCron } from "@/lib/trafego/segredo";
import { dia, PLATAFORMAS } from "@/lib/trafego/tipos";

export const runtime = "nodejs";
export const maxDuration = 300;

const LOTE = 500;
/** Intervalo mínimo entre sincronizações pelo botão, para não gastar a cota do provedor. */
const INTERVALO_MINIMO_MS = 5 * 60 * 1000;

const corpoSchema = z.object({
  workspaceId: z.uuid(),
  dias: z.number().int().min(1).max(60).default(60),
});

type Admin = ReturnType<typeof createAdminClient>;

async function sincronizarWorkspace(db: Admin, workspaceId: string, dias: number) {
  const de = dia(-dias);
  const ate = dia(-1);
  const resumo: Record<string, unknown>[] = [];

  const { data: contas } = await db
    .from("trafego_contas")
    .select("plataforma, conta_externa")
    .eq("workspace_id", workspaceId)
    .eq("ativo", true);

  for (const plataforma of PLATAFORMAS) {
    const ids = (contas ?? []).filter((c) => c.plataforma === plataforma).map((c) => c.conta_externa as string);
    if (!ids.length) continue;

    const { data: execucao } = await db
      .from("trafego_sincronizacoes")
      .insert({ workspace_id: workspaceId, conector: plataforma, status: "rodando" })
      .select("id")
      .single();

    try {
      const agora = new Date().toISOString();
      const resolvido = await provedorDoWorkspace(db, workspaceId, plataforma);
      if (!resolvido.ok) throw new Error(resolvido.motivo);
      const provedor = resolvido.provedor;
      const metricas = await provedor.lerMetricas({ plataforma, contas: ids, de, ate });
      const linhas = metricas.map((l) => ({
        workspace_id: workspaceId,
        data: l.data,
        plataforma: l.plataforma,
        conta_externa: l.contaExterna || ids[0],
        campanha_id: l.campanhaId,
        campanha: l.campanha,
        anuncio_id: l.anuncioId,
        anuncio: l.anuncio,
        gasto: l.gasto,
        impressoes: l.impressoes,
        cliques: l.cliques,
        page_views: l.pageViews,
        add_to_cart: l.addToCart,
        checkout: l.checkout,
        compras: l.compras,
        receita: l.receita,
        atualizado_em: agora,
      }));
      for (let i = 0; i < linhas.length; i += LOTE) {
        const { error } = await db.from("trafego_metricas_dia").upsert(linhas.slice(i, i + LOTE), {
          onConflict: "workspace_id,data,plataforma,conta_externa,campanha_id,anuncio_id",
        });
        if (error) throw new Error("Falha ao gravar métricas: " + error.message);
      }

      const campanhas = (await provedor.lerCampanhas({ plataforma, contas: ids, de: dia(-7), ate })).map((c) => ({
        workspace_id: workspaceId,
        plataforma: c.plataforma,
        campanha_id: c.campanhaId,
        conta_externa: c.contaExterna || ids[0],
        nome: c.nome,
        status: c.status,
        orcamento_diario: c.orcamentoDiario,
        moeda: c.moeda,
        atualizado_em: agora,
      }));
      if (campanhas.length) {
        const { error } = await db
          .from("trafego_campanhas")
          .upsert(campanhas, { onConflict: "workspace_id,plataforma,campanha_id" });
        if (error) throw new Error("Falha ao gravar campanhas: " + error.message);
      }

      if (execucao?.id) {
        await db.from("trafego_sincronizacoes")
          .update({ status: "ok", linhas: linhas.length, terminado_em: new Date().toISOString() })
          .eq("id", execucao.id);
      }
      resumo.push({ plataforma, linhas: linhas.length, campanhas: campanhas.length });
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      if (execucao?.id) {
        await db.from("trafego_sincronizacoes")
          .update({ status: "erro", erro: mensagem.slice(0, 500), terminado_em: new Date().toISOString() })
          .eq("id", execucao.id);
      }
      resumo.push({ plataforma, erro: mensagem });
    }
  }
  return { de, ate, resumo };
}

/** Cron da Vercel: todos os workspaces que têm conta de anúncio ativa. */
export async function GET(req: Request) {
  if (!ehChamadaDoCron(req)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  const db = createAdminClient();
  const { data } = await db.from("trafego_contas").select("workspace_id").eq("ativo", true);
  const workspaces = [...new Set((data ?? []).map((c) => c.workspace_id as string))];
  const resultados = [];
  for (const id of workspaces) {
    resultados.push({ workspaceId: id, ...(await sincronizarWorkspace(db, id, 3)) });
  }
  return NextResponse.json({ resultados });
}

/** Botão da tela: só o workspace de quem está logado. */
export async function POST(req: Request) {
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  const acesso = await papelNoWorkspace(parsed.data.workspaceId);
  if (!acesso) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  const db = createAdminClient();
  const { data: ultima } = await db
    .from("trafego_sincronizacoes")
    .select("iniciado_em")
    .eq("workspace_id", parsed.data.workspaceId)
    .order("iniciado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ultima && Date.now() - new Date(ultima.iniciado_em as string).getTime() < INTERVALO_MINIMO_MS) {
    return NextResponse.json({ erro: "Sincronizado há pouco. Aguarde 5 minutos para sincronizar de novo." }, { status: 429 });
  }

  const resultado = await sincronizarWorkspace(db, parsed.data.workspaceId, parsed.data.dias);
  const houveErro = resultado.resumo.some((r) => "erro" in r);
  return NextResponse.json(resultado, { status: houveErro ? 207 : 200 });
}
