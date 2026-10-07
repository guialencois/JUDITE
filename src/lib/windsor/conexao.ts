/**
 * O que a JUDITE guarda sobre a Windsor.ai de cada workspace (conexão "windsor" da tabela conexoes).
 *
 * A chave de API fica só no campo criptografado ("segredo"). Em "dados" ficam as listas de contas que a
 * Windsor devolveu, quais delas o dono escolheu e, por plataforma, de onde a JUDITE lê e age:
 * "propria" (conexão OAuth nativa, o padrão) ou "windsor". Nada aqui é secreto.
 *
 * Este arquivo não fala com a rede: são só regras, usadas pelo servidor e pelas telas.
 */

import type { Plataforma } from "@/lib/trafego/tipos";

export type Fonte = "propria" | "windsor";
export const NOME_FONTE: Record<Fonte, string> = { propria: "conexão própria (OAuth)", windsor: "Windsor.ai" };

/** Conectores da Windsor que a JUDITE usa. Os de anúncio têm o mesmo nome das plataformas do painel. */
export const CONECTORES_WINDSOR = ["google_ads", "facebook", "tiktok", "google_my_business", "searchconsole"] as const;
export type ConectorWindsor = (typeof CONECTORES_WINDSOR)[number];

export type ContaWindsor = { id: string; nome: string };

export type DadosWindsor = {
  /** Contas ligadas na Windsor, por conector, como vieram na última conferência da chave. */
  contas: Partial<Record<ConectorWindsor, ContaWindsor[]>>;
  /** IDs (da Windsor) que o dono escolheu para a JUDITE usar. */
  escolhidas: Partial<Record<ConectorWindsor, string[]>>;
  /** De onde vêm os dados e as ações de cada plataforma. "presenca" = Perfil da Empresa e Search Console (só leitura). */
  fonte: Partial<Record<Plataforma | "presenca", Fonte>>;
  validadoEm: string | null;
};

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ID_CONTA = /^[\x21-\x7E]{1,200}$/;

function listaDeContas(v: unknown): ContaWindsor[] {
  if (!Array.isArray(v)) return [];
  const saida: ContaWindsor[] = [];
  for (const item of v) {
    if (!ehObjeto(item)) continue;
    const id = typeof item.id === "string" || typeof item.id === "number" ? String(item.id) : "";
    if (!ID_CONTA.test(id)) continue;
    const nome = typeof item.nome === "string" ? item.nome : typeof item.name === "string" ? item.name : "";
    saida.push({ id, nome: (nome || id).slice(0, 200) });
  }
  return saida;
}

/** Lê o campo "dados" da conexão com tolerância: qualquer coisa fora do formato vira vazio. */
export function lerDadosWindsor(dados: unknown): DadosWindsor {
  const d = ehObjeto(dados) ? dados : {};
  const contas: DadosWindsor["contas"] = {};
  const escolhidas: DadosWindsor["escolhidas"] = {};
  const brutoContas = ehObjeto(d.contas) ? d.contas : {};
  const brutoEscolhidas = ehObjeto(d.escolhidas) ? d.escolhidas : {};
  for (const c of CONECTORES_WINDSOR) {
    contas[c] = listaDeContas(brutoContas[c]);
    const ids = Array.isArray(brutoEscolhidas[c]) ? (brutoEscolhidas[c] as unknown[]).map(String) : [];
    // Só vale escolha que ainda existe na lista da Windsor.
    escolhidas[c] = ids.filter((id) => contas[c]!.some((conta) => conta.id === id));
  }
  const fonte: DadosWindsor["fonte"] = {};
  const brutoFonte = ehObjeto(d.fonte) ? d.fonte : {};
  for (const k of ["google_ads", "facebook", "tiktok", "presenca"] as const) {
    fonte[k] = brutoFonte[k] === "windsor" ? "windsor" : "propria";
  }
  return { contas, escolhidas, fonte, validadoEm: typeof d.validado_em === "string" ? d.validado_em : null };
}

/** De onde vem a plataforma neste workspace. Sem conexão Windsor, ou sem o dono trocar, é sempre a conexão própria. */
export function fonteDaPlataforma(dados: unknown, plataforma: Plataforma | "presenca"): Fonte {
  return lerDadosWindsor(dados).fonte[plataforma] ?? "propria";
}

/** Contas escolhidas de um conector, já com o nome. */
export function contasEscolhidas(dados: unknown, conector: ConectorWindsor): ContaWindsor[] {
  const d = lerDadosWindsor(dados);
  const ids = d.escolhidas[conector] ?? [];
  return (d.contas[conector] ?? []).filter((c) => ids.includes(c.id));
}

/**
 * ID da conta no formato que a JUDITE já usa nas tabelas de tráfego (o mesmo dos provedores nativos):
 * Meta "act_123", Google Ads "123-456-7890", TikTok só os números. Assim, trocar a fonte de uma
 * plataforma não duplica métricas nem campanhas: as linhas caem nas mesmas chaves.
 */
export function contaCanonica(plataforma: Plataforma, id: string): string {
  const digitos = id.replace(/\D/g, "");
  if (plataforma === "facebook") return digitos ? `act_${digitos}` : id;
  if (plataforma === "google_ads") return digitos.length === 10 ? `${digitos.slice(0, 3)}-${digitos.slice(3, 6)}-${digitos.slice(6)}` : id;
  return digitos || id;
}

/** Acha, entre as contas escolhidas, a que corresponde a uma conta gravada pela JUDITE. */
export function contaWindsorDe(plataforma: Plataforma, escolhidas: ContaWindsor[], contaDaJudite: string): ContaWindsor | null {
  const alvo = contaCanonica(plataforma, contaDaJudite);
  return escolhidas.find((c) => contaCanonica(plataforma, c.id) === alvo) ?? null;
}
