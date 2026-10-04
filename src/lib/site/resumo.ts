/** Contas da aba Site, feitas em cima dos eventos do período. */

export type EventoSite = {
  ocorrido_em: string;
  tipo: "pageview" | "whatsapp" | "carrinho" | "evento";
  nome: string | null;
  caminho: string;
  origem: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  anuncio: "google" | "meta" | "tiktok" | null;
  dispositivo: string | null;
  cidade: string | null;
  regiao: string | null;
  visitante: string;
};

/** Evento gravado pelo modo de teste (?judite_teste=1 no site). Não entra em nenhuma conta. */
export const NOME_TESTE = "judite_teste";
export const ehTeste = (e: { tipo: string; nome: string | null }) => e.tipo === "evento" && e.nome === NOME_TESTE;

/** "há 5 min", "há 3 h", "há 2 dias": para o indicador de última visita recebida. */
export function haQuanto(iso: string, agora = Date.now()): string {
  const minutos = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000));
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/** Início do período (agora menos N dias), em ISO, para filtrar os eventos. */
export const inicioDoPeriodo = (dias: number): string => new Date(Date.now() - dias * 864e5).toISOString();

export type Linha = { rotulo: string; visitantes: number; visualizacoes: number; whatsapp: number; carrinho: number };

const NOME_ANUNCIO = { google: "Anúncio Google", meta: "Anúncio Meta", tiktok: "Anúncio TikTok" } as const;

/** De onde a visita veio, em linguagem simples. */
export function canal(e: EventoSite): string {
  if (e.anuncio) return NOME_ANUNCIO[e.anuncio];
  if (e.utm_source) return e.utm_source;
  const o = e.origem ?? "";
  if (!o) return "Direto / WhatsApp";
  if (/instagram/.test(o)) return "Instagram";
  if (/facebook|fb\.com/.test(o)) return "Facebook";
  if (/google\./.test(o)) return "Google (busca)";
  if (/tiktok/.test(o)) return "TikTok";
  return o;
}

export function agrupar(eventos: EventoSite[], chaveDe: (e: EventoSite) => string | null, limite = 10): Linha[] {
  // A visita é atribuída pelo primeiro evento de cada visitante no dia; ações herdam essa chave.
  const chaveDoVisitante = new Map<string, string>();
  for (const e of eventos) {
    const v = e.visitante + e.ocorrido_em.slice(0, 10);
    if (e.tipo === "pageview" && !chaveDoVisitante.has(v)) chaveDoVisitante.set(v, chaveDe(e) ?? "(não informado)");
  }
  const mapa = new Map<string, { visitantes: Set<string>; visualizacoes: number; whatsapp: number; carrinho: number }>();
  for (const e of eventos) {
    const v = e.visitante + e.ocorrido_em.slice(0, 10);
    const k = e.tipo === "pageview" ? chaveDe(e) ?? "(não informado)" : chaveDoVisitante.get(v) ?? chaveDe(e) ?? "(não informado)";
    const linha = mapa.get(k) ?? { visitantes: new Set<string>(), visualizacoes: 0, whatsapp: 0, carrinho: 0 };
    if (e.tipo === "pageview") {
      linha.visualizacoes++;
      linha.visitantes.add(v);
    } else if (e.tipo === "whatsapp") linha.whatsapp++;
    else if (e.tipo === "carrinho") linha.carrinho++;
    mapa.set(k, linha);
  }
  return [...mapa.entries()]
    .map(([rotulo, l]) => ({ rotulo, visitantes: l.visitantes.size, visualizacoes: l.visualizacoes, whatsapp: l.whatsapp, carrinho: l.carrinho }))
    .sort((a, b) => b.visitantes - a.visitantes || b.whatsapp - a.whatsapp)
    .slice(0, limite);
}

export function totais(eventos: EventoSite[]) {
  const visitantes = new Set(eventos.filter((e) => e.tipo === "pageview").map((e) => e.visitante + e.ocorrido_em.slice(0, 10)));
  const contar = (t: EventoSite["tipo"]) => eventos.filter((e) => e.tipo === t).length;
  const whatsapp = contar("whatsapp");
  return {
    visitantes: visitantes.size,
    visualizacoes: contar("pageview"),
    whatsapp,
    carrinho: contar("carrinho"),
    conversao: visitantes.size ? whatsapp / visitantes.size : null,
  };
}

/** Visitantes e cliques no WhatsApp por dia (horário de Brasília). */
export function porDia(eventos: EventoSite[], dias: number) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
  const mapa = new Map<string, { visitantes: Set<string>; whatsapp: number }>();
  for (let i = dias - 1; i >= 0; i--) mapa.set(fmt.format(new Date(Date.now() - i * 864e5)), { visitantes: new Set(), whatsapp: 0 });
  for (const e of eventos) {
    const d = mapa.get(fmt.format(new Date(e.ocorrido_em)));
    if (!d) continue;
    if (e.tipo === "pageview") d.visitantes.add(e.visitante);
    if (e.tipo === "whatsapp") d.whatsapp++;
  }
  return [...mapa.entries()].map(([data, d]) => ({ data, visitantes: d.visitantes.size, whatsapp: d.whatsapp }));
}
