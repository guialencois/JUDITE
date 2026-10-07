/**
 * Provedor nativo do TikTok Ads, pela TikTok Marketing API oficial (TikTok for Business).
 * Usa o access token salvo (criptografado) na página Conexões, obtido pelo OAuth do app.
 *
 * Documentação: https://business-api.tiktok.com/portal/docs
 *   - Relatório:  GET  /report/integrated/get/     (BASIC, nível de anúncio, por dia)
 *   - Campanhas:  GET  /campaign/get/
 *   - Status:     POST /campaign/status/update/    (operation_status ENABLE | DISABLE)
 *   - Orçamento:  POST /campaign/update/           (budget na moeda da conta, não em centavos)
 *
 * O TikTok responde HTTP 200 mesmo em erro; o que vale é o campo "code" (0 = certo).
 * Roda SOMENTE no servidor. O token vai no cabeçalho Access-Token, nunca na URL.
 */

import { TIKTOK_API_URL } from "@/lib/conexoes/config";
import type { AcaoAnuncio, LinhaCampanha, LinhaMetrica } from "@/lib/trafego/tipos";
import { ErroProvedor, numero, pedirJson, texto } from "./http";
import type { NovaCampanha, Periodo, ProvedorAnuncios } from "./provedor";

const MAX_PAGINAS = 50;
/** O relatório diário do TikTok aceita no máximo 30 dias por pedido. */
const DIAS_POR_PEDIDO = 30;

type Linha = Record<string, unknown>;
type Resposta = { code?: number; message?: string; data?: { list?: Linha[]; page_info?: { page?: number; total_page?: number } } };

export function erroDoTikTok(json: unknown): string | null {
  const r = json as Resposta | null;
  if (!r || typeof r.code !== "number") return "resposta inesperada";
  if (r.code === 0) return null;
  if (r.code === 40105 || r.code === 40104) return "o acesso ao TikTok venceu ou foi revogado. Autorize de novo em Conexões.";
  return `${r.message ?? "erro desconhecido"} (código ${r.code})`;
}

/** Quebra o período em janelas de até 30 dias (datas AAAA-MM-DD, inclusive). Exportada para os testes. */
export function janelas(de: string, ate: string, tamanho = DIAS_POR_PEDIDO): { de: string; ate: string }[] {
  const saida: { de: string; ate: string }[] = [];
  const fim = new Date(ate + "T12:00:00Z");
  let cursor = new Date(de + "T12:00:00Z");
  while (cursor <= fim) {
    const ultimo = new Date(cursor);
    ultimo.setUTCDate(ultimo.getUTCDate() + tamanho - 1);
    const limite = ultimo < fim ? ultimo : fim;
    saida.push({ de: cursor.toISOString().slice(0, 10), ate: limite.toISOString().slice(0, 10) });
    cursor = new Date(limite);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return saida;
}

/**
 * Converte uma linha do relatório. Page view, carrinho e checkout não são pedidos (ficam "não informado").
 * "Compras" usa a métrica conversion (conversões do objetivo da campanha). O valor das compras não é
 * lido do TikTok: o faturamento real vem das vendas registradas na página Comercial.
 */
export function metricaDoTikTok(linha: Linha, contaExterna: string): LinhaMetrica | null {
  const dim = (linha.dimensions ?? {}) as Linha;
  const m = (linha.metrics ?? {}) as Linha;
  const data = texto(dim.stat_time_day).slice(0, 10);
  if (!data) return null;
  return {
    data,
    plataforma: "tiktok",
    contaExterna,
    campanhaId: texto(m.campaign_id),
    campanha: texto(m.campaign_name),
    anuncioId: texto(dim.ad_id),
    anuncio: texto(m.ad_name),
    gasto: numero(m.spend) ?? 0,
    impressoes: numero(m.impressions) ?? 0,
    cliques: numero(m.clicks) ?? 0,
    pageViews: null,
    addToCart: null,
    checkout: null,
    compras: numero(m.conversion) ?? 0,
    receita: 0,
  };
}

export function campanhaDoTikTok(linha: Linha, contaExterna: string, moeda: string): LinhaCampanha | null {
  const campanhaId = texto(linha.campaign_id);
  if (!campanhaId) return null;
  const modo = texto(linha.budget_mode);
  const verba = numero(linha.budget);
  return {
    plataforma: "tiktok",
    campanhaId,
    contaExterna,
    nome: texto(linha.campaign_name),
    status: texto(linha.operation_status) || null,
    // Só é "orçamento diário" quando a campanha usa verba por dia; verba total ou sem limite fica vazia.
    orcamentoDiario: modo === "BUDGET_MODE_DAY" && verba !== null && verba > 0 ? verba : null,
    moeda,
  };
}

/** Objetivos do TikTok. "mensagens" não tem equivalente direto pela API: fica de fora. */
const OBJETIVO_TIKTOK: Partial<Record<NovaCampanha["objetivo"], string>> = {
  trafego: "TRAFFIC",
  conversoes: "WEB_CONVERSIONS",
  reconhecimento: "REACH",
};

/** Corpo enviado para criar a campanha no TikTok. Exportada para os testes: nasce sempre DISABLE (pausada). */
export function corpoNovaCampanhaTikTok(c: NovaCampanha): Record<string, unknown> {
  const objetivo = OBJETIVO_TIKTOK[c.objetivo];
  if (!objetivo) throw new ErroProvedor("O TikTok não tem campanha de mensagens pela JUDITE. Escolha outro objetivo ou crie na plataforma.");
  return {
    advertiser_id: c.conta,
    campaign_name: c.nome,
    objective_type: objetivo,
    budget_mode: "BUDGET_MODE_DAY",
    budget: Math.round(c.orcamentoDiarioReais * 100) / 100,
    operation_status: "DISABLE",
  };
}

export function provedorTikTok(cred: { token: string; moeda?: string | null }): ProvedorAnuncios {
  const cabecalhos = { "Access-Token": cred.token };

  async function ler(caminho: string, busca: Record<string, string>): Promise<Linha[]> {
    const linhas: Linha[] = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const params = new URLSearchParams({ ...busca, page: String(pagina), page_size: "1000" });
      const json = (await pedirJson("O TikTok", `${TIKTOK_API_URL}/${caminho}?${params.toString()}`, { headers: cabecalhos }, erroDoTikTok)) as Resposta;
      linhas.push(...(json.data?.list ?? []));
      if (pagina >= (json.data?.page_info?.total_page ?? 1)) break;
    }
    return linhas;
  }

  async function escrever(caminho: string, corpo: Record<string, unknown>): Promise<unknown> {
    return pedirJson("O TikTok", `${TIKTOK_API_URL}/${caminho}`, {
      method: "POST",
      headers: { ...cabecalhos, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }, erroDoTikTok);
  }

  return {
    nome: "TikTok Marketing API",
    statusAtiva: "ENABLE",
    statusPausada: "DISABLE",

    async lerMetricas(p: Periodo) {
      const saida: LinhaMetrica[] = [];
      for (const conta of p.contas) {
        for (const j of janelas(p.de, p.ate)) {
          const cruas = await ler("report/integrated/get/", {
            advertiser_id: conta,
            report_type: "BASIC",
            data_level: "AUCTION_AD",
            dimensions: JSON.stringify(["ad_id", "stat_time_day"]),
            metrics: JSON.stringify(["campaign_id", "campaign_name", "ad_name", "spend", "impressions", "clicks", "conversion"]),
            start_date: j.de,
            end_date: j.ate,
          });
          for (const l of cruas) {
            const m = metricaDoTikTok(l, conta);
            if (m) saida.push(m);
          }
        }
      }
      return saida;
    },

    async lerCampanhas(p: Periodo) {
      const saida: LinhaCampanha[] = [];
      for (const conta of p.contas) {
        const cruas = await ler("campaign/get/", { advertiser_id: conta });
        for (const l of cruas) {
          const c = campanhaDoTikTok(l, conta, cred.moeda || "BRL");
          if (c) saida.push(c);
        }
      }
      return saida;
    },

    async executar(acao: AcaoAnuncio) {
      if (acao.tipo === "definir_orcamento") {
        return escrever("campaign/update/", {
          advertiser_id: acao.conta, campaign_id: acao.campanhaId, budget: Math.round(acao.valorReais * 100) / 100,
        });
      }
      const operation_status = acao.tipo === "ativar" ? "ENABLE" : "DISABLE";
      if (acao.entidade === "campanha") {
        return escrever("campaign/status/update/", { advertiser_id: acao.conta, campaign_ids: [acao.entidadeId], operation_status });
      }
      if (acao.entidade === "conjunto") {
        return escrever("adgroup/status/update/", { advertiser_id: acao.conta, adgroup_ids: [acao.entidadeId], operation_status });
      }
      if (acao.entidade === "anuncio") {
        return escrever("ad/status/update/", { advertiser_id: acao.conta, ad_ids: [acao.entidadeId], operation_status });
      }
      throw new ErroProvedor("Ação não suportada no TikTok.");
    },

    async criarCampanhaPausada(c: NovaCampanha) {
      const json = (await escrever("campaign/create/", corpoNovaCampanhaTikTok(c))) as { data?: { campaign_id?: string | number } } | null;
      const id = json?.data?.campaign_id;
      if (!id) throw new ErroProvedor("O TikTok não devolveu o ID da campanha criada.");
      return { campanhaId: String(id) };
    },
  };
}
