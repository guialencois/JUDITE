/**
 * Junta as leituras da Presença no Google para a tela e para o Diretor.
 * Cada parte falha sozinha: se o Perfil da Empresa ainda não foi liberado pelo Google,
 * o Search Console continua aparecendo (e vice-versa), com o motivo de cada falha.
 */

import { deslocar } from "@/lib/diretor/resumo";
import type { createAdminClient } from "@/lib/supabase/admin";
import { hojeEmBrasilia } from "@/lib/trafego/mes";
import {
  abrirPresenca, lerAvaliacoes, lerBusca, lerDesempenho, lerLocal,
  type AcessoPresenca, type Avaliacoes, type DesempenhoPerfil, type LinhaBusca, type LocalPerfil,
} from "./google";

type Admin = ReturnType<typeof createAdminClient>;

export const DIAS_PRESENCA = 28;

export type Parte<T> = { ok: true; dados: T } | { ok: false; motivo: string };

async function tentar<T>(fn: () => Promise<T>): Promise<Parte<T>> {
  try {
    return { ok: true, dados: await fn() };
  } catch (erro) {
    return { ok: false, motivo: erro instanceof Error ? erro.message : "Falha ao falar com o Google." };
  }
}

export type Presenca = {
  acesso: AcessoPresenca;
  periodo: { de: string; ate: string; dias: number };
  perfil: Parte<LocalPerfil> | null;
  avaliacoes: Parte<Avaliacoes> | null;
  desempenho: Parte<DesempenhoPerfil> | null;
  buscaTotal: Parte<LinhaBusca[]> | null;
  consultas: Parte<LinhaBusca[]> | null;
  paginas: Parte<LinhaBusca[]> | null;
};

export async function lerPresenca(db: Admin, workspaceId: string): Promise<{ ok: true; presenca: Presenca } | { ok: false; motivo: string }> {
  const aberto = await abrirPresenca(db, workspaceId);
  if (!aberto.ok) return aberto;
  const a = aberto.acesso;
  const hoje = hojeEmBrasilia();
  // O Search Console e o desempenho do perfil chegam com 2 a 3 dias de atraso.
  const ate = deslocar(hoje, -3);
  const de = deslocar(ate, -(DIAS_PRESENCA - 1));

  const temPerfil = Boolean(a.conta && a.local);
  const [perfil, avaliacoes, desempenho, buscaTotal, consultas, paginas] = await Promise.all([
    temPerfil ? tentar(() => lerLocal(a)) : null,
    temPerfil ? tentar(() => lerAvaliacoes(a)) : null,
    temPerfil ? tentar(() => lerDesempenho(a, de, ate, DIAS_PRESENCA)) : null,
    a.siteGsc ? tentar(() => lerBusca(a, de, ate, null, 1)) : null,
    a.siteGsc ? tentar(() => lerBusca(a, de, ate, "query", 25)) : null,
    a.siteGsc ? tentar(() => lerBusca(a, de, ate, "page", 15)) : null,
  ]);
  return { ok: true, presenca: { acesso: a, periodo: { de, ate, dias: DIAS_PRESENCA }, perfil, avaliacoes, desempenho, buscaTotal, consultas, paginas } };
}

/** O que falta preencher no perfil (só fatos lidos do Google, sem palpite). */
export function lacunasDoPerfil(p: LocalPerfil): string[] {
  const faltas: string[] = [];
  if (!p.descricao) faltas.push("descrição da empresa");
  if (!p.site) faltas.push("endereço do site");
  if (!p.telefone) faltas.push("telefone");
  if (!p.temHorario) faltas.push("horário de funcionamento");
  if (!p.categoria) faltas.push("categoria principal");
  return faltas;
}

const dados = <T>(p: Parte<T> | null): T | null => (p && p.ok ? p.dados : null);

/**
 * Versão compacta para o Diretor. Avaliações entram sem o nome de quem escreveu
 * (o texto é público no Google, mas o nome não é necessário para a análise).
 */
export function resumoDaPresenca(p: Presenca) {
  const perfil = dados(p.perfil);
  const avaliacoes = dados(p.avaliacoes);
  const desempenho = dados(p.desempenho);
  const total = dados(p.buscaTotal)?.[0];
  const arred = (n: number) => Math.round(n * 100) / 100;
  return {
    periodo: p.periodo,
    perfil_da_empresa: perfil ? {
      nome: perfil.titulo,
      categoria: perfil.categoria,
      itens_faltando_no_perfil: lacunasDoPerfil(perfil),
      nota_media: avaliacoes?.media ?? null,
      total_de_avaliacoes: avaliacoes?.total ?? null,
      avaliacoes_recentes_sem_resposta: avaliacoes ? avaliacoes.lista.filter((a) => !a.resposta).length : null,
      avaliacoes_recentes: (avaliacoes?.lista ?? []).slice(0, 8).map((a) => ({
        estrelas: a.estrelas, comentario: a.comentario ? a.comentario.slice(0, 300) : null, respondida: Boolean(a.resposta),
      })),
      desempenho: desempenho ? {
        visualizacoes_do_perfil: desempenho.visualizacoes, cliques_para_o_site: desempenho.cliquesNoSite,
        ligacoes: desempenho.ligacoes, pedidos_de_rota: desempenho.rotas,
      } : null,
    } : null,
    busca_do_google: p.acesso.siteGsc ? {
      propriedade: p.acesso.siteGsc,
      total: total ? { cliques: total.cliques, impressoes: total.impressoes, ctr: arred(total.ctr), posicao_media: arred(total.posicao) } : null,
      principais_consultas: (dados(p.consultas) ?? []).slice(0, 15).map((l) => ({
        consulta: l.chave, cliques: l.cliques, impressoes: l.impressoes, posicao_media: arred(l.posicao),
      })),
      principais_paginas: (dados(p.paginas) ?? []).slice(0, 8).map((l) => ({
        pagina: l.chave, cliques: l.cliques, impressoes: l.impressoes, posicao_media: arred(l.posicao),
      })),
    } : null,
    falhas_de_leitura: [p.perfil, p.avaliacoes, p.desempenho, p.buscaTotal, p.consultas, p.paginas]
      .filter((x): x is { ok: false; motivo: string } => Boolean(x && !x.ok)).map((x) => x.motivo)
      .filter((m, i, lista) => lista.indexOf(m) === i),
  };
}
