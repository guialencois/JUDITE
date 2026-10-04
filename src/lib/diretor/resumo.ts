/**
 * Monta o resumo dos dados do workspace que vai para o Diretor (IA).
 * Só entra o que está no banco: tráfego sincronizado, eventos do site, vendas registradas, metas e limites.
 * Quando falta dado, entra um aviso em "avisos" em vez de um número.
 *
 * construirResumo() é pura (testável); carregarResumo() busca as linhas no banco.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { progressoDasMetas, resumir, agruparVendas, type MetricaMeta, type Venda } from "@/lib/comercial/contas";
import { CONEXAO_DA_PLATAFORMA } from "@/lib/conexoes/status";
import { agrupar, canal, ehTeste, totais as totaisDoSite, type EventoSite } from "@/lib/site/resumo";
import { diasRestantesNoMes, hojeEmBrasilia, lerLimites, limitesDoMes } from "@/lib/trafego/mes";
import { campanhaAtiva, metricaDoBanco, NOME_PLATAFORMA, PLATAFORMAS, type LinhaMetrica, type Plataforma } from "@/lib/trafego/tipos";
import { CLIQUES_MINIMOS, CONVERSOES_MINIMAS, DIAS_MINIMOS } from "./regras";
import type { CampanhaResumo, ResumoDiretor, TotaisSimples } from "./tipos";

export const JANELA_DIAS = 14;
const SITE_DIAS = 7;

const arred = (n: number) => Math.round(n * 100) / 100;

function somar(linhas: LinhaMetrica[]): TotaisSimples {
  const t = linhas.reduce((s, l) => ({
    gasto: s.gasto + l.gasto, impressoes: s.impressoes + l.impressoes, cliques: s.cliques + l.cliques,
    compras: s.compras + l.compras, receita: s.receita + l.receita,
  }), { gasto: 0, impressoes: 0, cliques: 0, compras: 0, receita: 0 });
  return { gasto: arred(t.gasto), impressoes: t.impressoes, cliques: t.cliques, compras: arred(t.compras), receita: arred(t.receita) };
}

/** Data AAAA-MM-DD deslocada em dias a partir de uma data base. */
export function deslocar(base: string, dias: number): string {
  const d = new Date(base + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export type DadosBrutos = {
  hoje: string;
  metricas: LinhaMetrica[];
  campanhas: { plataforma: string; campanha_id: string; nome: string; status: string | null; orcamento_diario: number | null }[];
  conexoesProntas: string[];
  site: { dominio: string } | null;
  eventosSite: EventoSite[];
  vendasDoMes: Venda[];
  metas: { metrica: MetricaMeta; alvo: number }[];
  config: { chave: string; valor: unknown }[];
  gastoNoMes: number;
};

export function construirResumo(d: DadosBrutos): ResumoDiretor {
  const ate = deslocar(d.hoje, -1);
  const de = deslocar(d.hoje, -JANELA_DIAS);
  const deAnterior = deslocar(d.hoje, -JANELA_DIAS * 2);
  const atual = d.metricas.filter((l) => l.data >= de && l.data <= ate);
  const anterior = d.metricas.filter((l) => l.data >= deAnterior && l.data < de);

  const campanhas: CampanhaResumo[] = d.campanhas.map((c) => {
    const linhas = atual.filter((l) => l.plataforma === c.plataforma && l.campanhaId === c.campanha_id);
    const t = somar(linhas);
    const dias = new Set(linhas.filter((l) => l.impressoes > 0 || l.gasto > 0).map((l) => l.data)).size;
    return {
      ...t,
      plataforma: c.plataforma,
      campanha_id: c.campanha_id,
      nome: c.nome || c.campanha_id,
      status: c.status,
      ativa: campanhaAtiva(c.status),
      orcamento_diario: c.orcamento_diario,
      dias_com_dados: dias,
      ctr: t.impressoes > 0 ? arred((t.cliques / t.impressoes) * 100) / 100 : null,
      cpc: t.cliques > 0 ? arred(t.gasto / t.cliques) : null,
    };
  }).sort((a, b) => b.gasto - a.gasto).slice(0, 40);

  const eventos = d.eventosSite.filter((e) => !ehTeste(e));
  const tSite = totaisDoSite(eventos);
  const limites = lerLimites(d.config);
  const comercial = resumir(d.vendasDoMes, d.gastoNoMes);

  const avisos: string[] = [];
  if (!d.conexoesProntas.length) avisos.push("Nenhuma plataforma de anúncios está conectada.");
  if (!d.metricas.length) avisos.push("Não há métricas de anúncios sincronizadas nos últimos 28 dias.");
  if (!d.site) avisos.push("Nenhum site cadastrado na aba Site.");
  else if (!eventos.length) avisos.push(`O site ${d.site.dominio} não registrou visitas nos últimos ${SITE_DIAS} dias.`);
  if (!d.vendasDoMes.length) avisos.push("Nenhuma venda foi registrada na página Comercial neste mês; ROAS real e CAC não podem ser calculados.");
  if (!d.metas.length) avisos.push("Não há metas definidas para este mês.");

  return {
    hoje: d.hoje,
    janela: { dias: JANELA_DIAS, de, ate },
    conexoes: PLATAFORMAS.map((p: Plataforma) => ({ plataforma: NOME_PLATAFORMA[p], conectada: d.conexoesProntas.includes(CONEXAO_DA_PLATAFORMA[p]) })),
    trafego: {
      periodo_atual: somar(atual),
      periodo_anterior: somar(anterior),
      por_plataforma: PLATAFORMAS
        .map((p) => ({ plataforma: p as string, ...somar(atual.filter((l) => l.plataforma === p)) }))
        .filter((p) => p.impressoes > 0 || p.gasto > 0),
    },
    campanhas,
    site: d.site ? {
      dominio: d.site.dominio,
      dias: SITE_DIAS,
      visitantes: tSite.visitantes,
      visualizacoes: tSite.visualizacoes,
      cliques_whatsapp: tSite.whatsapp,
      conversao_whatsapp: tSite.conversao === null ? null : arred(tSite.conversao * 100) / 100,
      origens: agrupar(eventos, canal, 8).map((l) => ({ origem: l.rotulo, visitantes: l.visitantes, whatsapp: l.whatsapp })),
      paginas: agrupar(eventos, (e) => e.caminho, 8).map((l) => ({ pagina: l.rotulo, visitantes: l.visitantes, whatsapp: l.whatsapp })),
    } : null,
    comercial: {
      mes: d.hoje.slice(0, 7),
      faturamento: arred(comercial.faturamento),
      vendas: comercial.vendas,
      ticket_medio: comercial.ticketMedio === null ? null : arred(comercial.ticketMedio),
      roas_real: comercial.roasReal === null ? null : arred(comercial.roasReal),
      cac: comercial.cac === null ? null : arred(comercial.cac),
      por_produto: agruparVendas(d.vendasDoMes, (v) => v.produto).slice(0, 8)
        .map((g) => ({ produto: g.rotulo, vendas: g.vendas, faturamento: arred(g.faturamento) })),
    },
    metas: progressoDasMetas(d.metas, comercial, d.gastoNoMes).map((m) => ({
      metrica: m.metrica, alvo: m.alvo, atual: m.atual === null ? null : arred(m.atual),
    })),
    limites: {
      orcamento_diario_max_sem_aprovacao: limites.maxSemAprovacao,
      aumento_max_por_ajuste_percent: limites.aumentoMaxPercent,
      orcamento_mensal_max: limites.mensalMax,
      gasto_no_mes: arred(d.gastoNoMes),
      dias_restantes_no_mes: diasRestantesNoMes(d.hoje),
    },
    regras: { dias_minimos_de_dados: DIAS_MINIMOS, cliques_minimos: CLIQUES_MINIMOS, conversoes_minimas_para_aumentar: CONVERSOES_MINIMAS },
    avisos,
  };
}

/** Busca no banco tudo o que o resumo precisa. Chamar só no servidor, depois de conferir quem pediu. */
export async function carregarResumo(db: SupabaseClient, workspaceId: string): Promise<ResumoDiretor> {
  const hoje = hojeEmBrasilia();
  const { inicio: inicioMes } = limitesDoMes(hoje.slice(0, 7));
  const desde = deslocar(hoje, -JANELA_DIAS * 2);
  const desdeSite = new Date(Date.now() - SITE_DIAS * 864e5).toISOString();

  const [metricas, campanhas, conexoes, sites, vendas, metas, config, gastos] = await Promise.all([
    db.from("trafego_metricas_dia").select("*").eq("workspace_id", workspaceId).gte("data", desde).lte("data", hoje).limit(50000),
    db.from("trafego_campanhas").select("plataforma, campanha_id, nome, status, orcamento_diario").eq("workspace_id", workspaceId),
    db.from("conexoes").select("provedor, conectado_em").eq("workspace_id", workspaceId),
    db.from("sites").select("id, dominio").eq("workspace_id", workspaceId).order("criado_em").limit(1),
    db.from("trafego_vendas").select("id, data, produto, pessoas, valor, origem, campanha_id, observacao")
      .eq("workspace_id", workspaceId).gte("data", inicioMes).lte("data", hoje).limit(5000),
    db.from("trafego_metas").select("metrica, alvo").eq("workspace_id", workspaceId).eq("mes", inicioMes),
    db.from("trafego_config").select("chave, valor").eq("workspace_id", workspaceId),
    db.from("trafego_metricas_dia").select("gasto").eq("workspace_id", workspaceId).gte("data", inicioMes).lte("data", hoje).limit(50000),
  ]);

  const site = sites.data?.[0] ?? null;
  const eventos = site
    ? await db.from("site_eventos")
      .select("ocorrido_em, tipo, nome, caminho, origem, utm_source, utm_campaign, anuncio, dispositivo, cidade, regiao, visitante")
      .eq("site_id", site.id).gte("ocorrido_em", desdeSite).order("ocorrido_em", { ascending: true }).limit(50000)
    : { data: [] };

  return construirResumo({
    hoje,
    metricas: (metricas.data ?? []).map(metricaDoBanco),
    campanhas: (campanhas.data ?? []).map((c) => ({
      plataforma: c.plataforma as string, campanha_id: c.campanha_id as string, nome: (c.nome as string) ?? "",
      status: (c.status as string | null) ?? null,
      orcamento_diario: c.orcamento_diario === null || c.orcamento_diario === undefined ? null : Number(c.orcamento_diario),
    })),
    conexoesProntas: (conexoes.data ?? []).filter((c) => c.conectado_em).map((c) => c.provedor as string),
    site: site ? { dominio: site.dominio as string } : null,
    eventosSite: (eventos.data ?? []) as EventoSite[],
    vendasDoMes: (vendas.data ?? []).map((v) => ({
      id: v.id as string, data: v.data as string, produto: v.produto as string, pessoas: Number(v.pessoas), valor: Number(v.valor),
      origem: (v.origem as string | null) ?? null, campanha_id: (v.campanha_id as string | null) ?? null, observacao: null,
    })),
    metas: (metas.data ?? []).map((m) => ({ metrica: m.metrica as MetricaMeta, alvo: Number(m.alvo) })),
    config: config.data ?? [],
    gastoNoMes: (gastos.data ?? []).reduce((s, l) => s + Number(l.gasto ?? 0), 0),
  });
}
