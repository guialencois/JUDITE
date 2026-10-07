import { afterEach, describe, expect, it, vi } from "vitest";
import { situacaoDe } from "@/lib/conexoes/status";
import { cifrar } from "@/lib/cripto";
import { avaliacoesDaWindsor, buscaDaWindsor, desempenhoDaWindsor } from "@/lib/presenca/windsor";
import type { createAdminClient } from "@/lib/supabase/admin";
import { lerWindsor, semChave } from "@/lib/windsor/api";
import { contaCanonica, fonteDaPlataforma, lerDadosWindsor } from "@/lib/windsor/conexao";
import { interpretarResultado, listarContasWindsor, type ChamarWindsor } from "@/lib/windsor/mcp";
import { provedorDoWorkspace } from "./provedor";
import { acaoDaWindsor, campanhaDaWindsor, metricaDaWindsor, paramsNovaCampanhaWindsor, provedorWindsor } from "./windsor";

const CHAVE = "chave-secreta-de-teste-1234567890";
const WS = "22222222-2222-4222-8222-222222222222";
type Chamada = { url: string; init: RequestInit | undefined };

/** fetch simulado: cada resposta é escolhida pelo endereço pedido. */
function simular(responder: (url: string) => { status?: number; corpo: unknown }) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (entrada, init) => {
    const url = String(entrada);
    chamadas.push({ url, init });
    const r = responder(url);
    return new Response(typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }));
  return chamadas;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Windsor: mapeamento das métricas", () => {
  it("Meta: valores em reais, data certa, conta no formato da JUDITE e a compra contada uma vez só", () => {
    const m = metricaDaWindsor("facebook", {
      date: "2026-10-05", account_id: "1234567890", campaign: "Passeios", campaign_id: "c1", ad_id: "a1", ad_name: "Vídeo",
      spend: "87.5", impressions: 4000, clicks: 300, actions_link_click: 120, actions_landing_page_view: 90,
      actions_offsite_conversion_fb_pixel_add_to_cart: 7, actions_add_to_cart: 9,
      actions_offsite_conversion_fb_pixel_purchase: 3, actions_purchase: 3, actions_omni_purchase: 3,
      action_values_offsite_conversion_fb_pixel_purchase: 900, action_values_purchase: 900,
    });
    expect(m).toEqual({
      data: "2026-10-05", plataforma: "facebook", contaExterna: "act_1234567890", campanhaId: "c1", campanha: "Passeios",
      anuncioId: "a1", anuncio: "Vídeo", gasto: 87.5, impressoes: 4000, cliques: 120, pageViews: 90,
      addToCart: 7, checkout: 0, compras: 3, receita: 900,
    });
  });

  it("Meta: sem dado do pixel, usa o tipo seguinte; sem clique no link, usa os cliques gerais", () => {
    const m = metricaDaWindsor("facebook", {
      date: "2026-10-05T00:00:00", account_id: "act_55555", campaign_id: "c2", spend: 10, impressions: 50, clicks: 8,
      actions_offsite_conversion_fb_pixel_purchase: null, actions_purchase: 2, action_values_purchase: "150.40",
    });
    expect(m?.data).toBe("2026-10-05");
    expect(m?.contaExterna).toBe("act_55555");
    expect(m?.cliques).toBe(8);
    expect(m?.compras).toBe(2);
    expect(m?.receita).toBe(150.4);
  });

  it("Google Ads e TikTok: o que a plataforma não informa fica null (não zero)", () => {
    const g = metricaDaWindsor("google_ads", {
      date: "2026-10-04", account_id: "4110713742", campaign: "Busca", campaign_id: "77", spend: 42.1, impressions: 900, clicks: 60,
      conversions: 2.5, conversion_value: 510,
    });
    expect(g).toMatchObject({
      contaExterna: "411-071-3742", gasto: 42.1, compras: 2.5, receita: 510, pageViews: null, addToCart: null, checkout: null, anuncioId: "",
    });
    const t = metricaDaWindsor("tiktok", { date: "2026-10-04", account_id: "7000111", campaign_id: "9", ad_id: "5", spend: 12, clicks: 4, conversions: 1 });
    expect(t).toMatchObject({ contaExterna: "7000111", gasto: 12, compras: 1, receita: 0, pageViews: null, anuncioId: "5" });
  });

  it("linha sem data válida ou sem campanha é descartada", () => {
    expect(metricaDaWindsor("facebook", { account_id: "1", campaign_id: "c", spend: 5 })).toBeNull();
    expect(metricaDaWindsor("facebook", { date: "ontem", campaign_id: "c" })).toBeNull();
    expect(metricaDaWindsor("google_ads", { date: "2026-10-04", spend: 5 })).toBeNull();
  });
});

describe("Windsor: mapeamento das campanhas (orçamento diário sempre em reais)", () => {
  it("Meta vem em centavos; Google já vem em reais; TikTok só conta quando a verba é por dia", () => {
    expect(campanhaDaWindsor("facebook", {
      account_id: "123", campaign: "A", campaign_id: "c1", campaign_configured_status: "active", campaign_daily_budget: 5000, account_currency: "BRL",
    })).toEqual({ plataforma: "facebook", campanhaId: "c1", contaExterna: "act_123", nome: "A", status: "ACTIVE", orcamentoDiario: 50, moeda: "BRL" });

    expect(campanhaDaWindsor("google_ads", {
      account_id: "411-071-3742", campaign: "B", campaign_id: "77", campaign_status: "PAUSED", budget_amount: "35.5", account_currency_code: "BRL",
    })).toMatchObject({ contaExterna: "411-071-3742", status: "PAUSED", orcamentoDiario: 35.5, moeda: "BRL" });

    const base = { account_id: "7000111", campaign: "C", campaign_id: "9", campaign_operation_status: "ENABLE", campaign_budget: 80, currency: "BRL" };
    expect(campanhaDaWindsor("tiktok", { ...base, campaign_budget_mode: "BUDGET_MODE_DAY" })?.orcamentoDiario).toBe(80);
    expect(campanhaDaWindsor("tiktok", { ...base, campaign_budget_mode: "BUDGET_MODE_TOTAL" })?.orcamentoDiario).toBeNull();
  });

  it("sem orçamento na campanha fica null; moeda sem centavos não é dividida por 100", () => {
    expect(campanhaDaWindsor("facebook", { account_id: "1", campaign_id: "c", campaign_daily_budget: null })?.orcamentoDiario).toBeNull();
    expect(campanhaDaWindsor("facebook", { account_id: "1", campaign_id: "c", campaign_daily_budget: 0 })?.orcamentoDiario).toBeNull();
    expect(campanhaDaWindsor("facebook", { account_id: "1", campaign_id: "c", campaign_daily_budget: 3000, account_currency: "JPY" })?.orcamentoDiario).toBe(3000);
  });

  it("lerCampanhas fica só com o dia mais recente de cada campanha e pede as contas pelo ID da Windsor", async () => {
    const chamadas = simular(() => ({
      corpo: { data: [
        { date: "2026-10-05", account_id: "123", campaign: "A", campaign_id: "c1", campaign_configured_status: "PAUSED", campaign_daily_budget: 7000 },
        { date: "2026-10-03", account_id: "123", campaign: "A", campaign_id: "c1", campaign_configured_status: "ACTIVE", campaign_daily_budget: 5000 },
      ] },
    }));
    const provedor = provedorWindsor({ chave: CHAVE, plataforma: "facebook", contas: [{ id: "123", nome: "Conta" }] });
    const campanhas = await provedor.lerCampanhas({ plataforma: "facebook", contas: ["act_123"], de: "2026-10-01", ate: "2026-10-06" });
    expect(campanhas).toEqual([expect.objectContaining({ campanhaId: "c1", status: "PAUSED", orcamentoDiario: 70 })]);
    const url = new URL(chamadas[0].url);
    expect(url.origin + url.pathname).toBe("https://connectors.windsor.ai/facebook");
    expect(url.searchParams.get("select_accounts")).toBe("123");
    expect(url.searchParams.get("date_from")).toBe("2026-10-01");
    expect(url.searchParams.get("date_to")).toBe("2026-10-06");
  });

  it("conta que o dono não escolheu na Windsor não é lida", async () => {
    const chamadas = simular(() => ({ corpo: { data: [] } }));
    const provedor = provedorWindsor({ chave: CHAVE, plataforma: "facebook", contas: [{ id: "123", nome: "Conta" }] });
    expect(await provedor.lerMetricas({ plataforma: "facebook", contas: ["act_999"], de: "2026-10-01", ate: "2026-10-06" })).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });
});

describe("Windsor: a chave nunca aparece em erro", () => {
  const pedido = { conector: "facebook", campos: ["date", "spend"], de: "2026-10-01", ate: "2026-10-02" };
  const semVazamento = (mensagem: string) => {
    expect(mensagem).not.toContain(CHAVE);
    expect(mensagem).not.toContain("api_key");
    expect(mensagem).not.toContain("connectors.windsor.ai");
  };

  it("chave recusada: a Windsor repete a chave na resposta, e a JUDITE não repassa", async () => {
    simular(() => ({ status: 400, corpo: { error: `Please check the API key used: ${CHAVE}`, code: "user_error" } }));
    const erro = await lerWindsor(CHAVE, pedido).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    semVazamento((erro as Error).message);
    expect((erro as Error).message).toContain("recusou a chave");
  });

  it("erro qualquer com a URL completa no corpo sai sem chave e sem endereço", async () => {
    simular((url) => ({ status: 500, corpo: `falha ao processar ${url}` }));
    const erro = await lerWindsor(CHAVE, pedido).catch((e: Error) => e);
    semVazamento((erro as Error).message);
    expect((erro as Error).message).toContain("500");
  });

  it("falha de rede que carrega a URL na mensagem vira aviso genérico", async () => {
    vi.stubGlobal("fetch", vi.fn(async (entrada: unknown) => { throw new TypeError(`fetch failed: ${String(entrada)}`); }));
    const erro = await lerWindsor(CHAVE, pedido).catch((e: Error) => e);
    semVazamento((erro as Error).message);
  });

  it("semChave cobre a chave pura e a codificada para URL", () => {
    const chave = "a b+c/d=";
    expect(semChave(`x ${chave} y ${encodeURIComponent(chave)} z`, chave)).toBe("x *** y *** z");
  });

  it("resultado de uma ação que traga a chave é limpo antes de ir para o histórico", async () => {
    const chamar: ChamarWindsor = async () => ({ ok: true, eco: `Bearer ${CHAVE}` });
    const provedor = provedorWindsor({ chave: CHAVE, plataforma: "facebook", contas: [{ id: "123", nome: "Conta" }], chamar });
    const r = await provedor.executar({ tipo: "pausar", plataforma: "facebook", conta: "act_123", entidade: "campanha", entidadeId: "c1" });
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });
});

describe("Windsor: ações de escrita pelo MCP", () => {
  it("traduz pausar, ativar e orçamento para a ação e a unidade de cada plataforma", () => {
    expect(acaoDaWindsor({ tipo: "pausar", plataforma: "facebook", conta: "act_1", entidade: "campanha", entidadeId: "c1" }))
      .toEqual({ action: "pause_campaign", params: { campaign_id: "c1" } });
    expect(acaoDaWindsor({ tipo: "ativar", plataforma: "tiktok", conta: "1", entidade: "conjunto", entidadeId: "g1" }))
      .toEqual({ action: "enable_ad_group", params: { ad_group_id: "g1" } });
    expect(acaoDaWindsor({ tipo: "definir_orcamento", plataforma: "facebook", conta: "act_1", campanhaId: "c1", valorReais: 55.5 }))
      .toEqual({ action: "set_campaign_budget", params: { campaign_id: "c1", budget_type: "daily", amount: 5550 } });
    expect(acaoDaWindsor({ tipo: "definir_orcamento", plataforma: "google_ads", conta: "1", campanhaId: "77", valorReais: 55.5 }))
      .toEqual({ action: "set_campaign_budget", params: { campaign_id: "77", budget_type: "daily", amount_micros: 55_500_000 } });
    expect(acaoDaWindsor({ tipo: "definir_orcamento", plataforma: "tiktok", conta: "1", campanhaId: "9", valorReais: 60 }))
      .toEqual({ action: "set_campaign_budget", params: { campaign_id: "9", amount: 60 } });
  });

  it("não arredonda por conta própria: TikTok com centavos é recusado em vez de mudar o valor aprovado", () => {
    expect(() => acaoDaWindsor({ tipo: "definir_orcamento", plataforma: "tiktok", conta: "1", campanhaId: "9", valorReais: 60.5 })).toThrow(/valor inteiro/);
  });

  it("executa na conta escolhida, com o ID da Windsor, e recusa conta fora da lista", async () => {
    const chamadas: { ferramenta: string; args: Record<string, unknown> }[] = [];
    const chamar: ChamarWindsor = async (_chave, ferramenta, args) => { chamadas.push({ ferramenta, args }); return { status: "ok" }; };
    const provedor = provedorWindsor({ chave: CHAVE, plataforma: "google_ads", contas: [{ id: "4110713742", nome: "Conta" }], chamar });

    await provedor.executar({ tipo: "pausar", plataforma: "google_ads", conta: "411-071-3742", entidade: "campanha", entidadeId: "77" });
    expect(chamadas).toEqual([{
      ferramenta: "execute_action",
      args: { connector: "google_ads", action: "pause_campaign", account: "4110713742", params: { campaign_id: "77" } },
    }]);

    await expect(provedor.executar({ tipo: "pausar", plataforma: "google_ads", conta: "999-999-9999", entidade: "campanha", entidadeId: "77" }))
      .rejects.toThrow(/não está entre as escolhidas/);
    expect(chamadas).toHaveLength(1);
  });

  it("campanha criada pela Windsor nasce sempre pausada, e só a Meta tem criação", async () => {
    const nova = { conta: "act_123", nome: "Nova", objetivo: "trafego" as const, orcamentoDiarioReais: 40 };
    expect(paramsNovaCampanhaWindsor(nova)).toMatchObject({ status: "paused", daily_budget: 4000, objective: "OUTCOME_TRAFFIC" });

    const chamadas: Record<string, unknown>[] = [];
    const chamar: ChamarWindsor = async (_c, _f, args) => { chamadas.push(args); return { campaign_id: "nova-1" }; };
    const meta = provedorWindsor({ chave: CHAVE, plataforma: "facebook", contas: [{ id: "123", nome: "Conta" }], chamar });
    expect(await meta.criarCampanhaPausada?.(nova)).toEqual({ campanhaId: "nova-1" });
    expect(chamadas[0]).toMatchObject({ action: "create_campaign", account: "123", params: { status: "paused" } });

    expect(provedorWindsor({ chave: CHAVE, plataforma: "google_ads", contas: [], chamar }).criarCampanhaPausada).toBeUndefined();
    expect(provedorWindsor({ chave: CHAVE, plataforma: "tiktok", contas: [], chamar }).criarCampanhaPausada).toBeUndefined();
  });

  it("lê o resultado das ferramentas e a lista de contas só dos conectores que a JUDITE usa", async () => {
    expect(interpretarResultado({ content: [{ type: "text", text: "{\"result\":[1,2]}" }] })).toEqual([1, 2]);
    expect(interpretarResultado({ structuredContent: { result: { a: 1 } } })).toEqual({ a: 1 });
    const chamar: ChamarWindsor = async () => [
      { id: "facebook", accounts: [{ id: "123", name: "Loja" }, { id: 456 }] },
      { id: "instagram", accounts: [{ id: "x", name: "Perfil" }] },
      { id: "google_my_business", accounts: [{ id: "locations/1", name: "Guia" }] },
    ];
    expect(await listarContasWindsor(CHAVE, chamar)).toEqual({
      facebook: [{ id: "123", nome: "Loja" }, { id: "456", nome: "456" }],
      google_my_business: [{ id: "locations/1", nome: "Guia" }],
    });
  });
});

describe("escolha do provedor por workspace", () => {
  /** Banco simulado: só a tabela conexoes, com as linhas dadas por provedor. */
  function banco(linhas: Record<string, { dados: Record<string, unknown>; segredos?: Record<string, string> }>) {
    const consulta = (provedor = "") => ({
      eq: (coluna: string, valor: string) => consulta(coluna === "provedor" ? valor : provedor),
      maybeSingle: async () => {
        const l = linhas[provedor];
        return { data: l ? { dados: l.dados, segredo: l.segredos ? cifrar(l.segredos) : null } : null };
      },
    });
    return { from: () => ({ select: () => consulta() }) } as unknown as ReturnType<typeof createAdminClient>;
  }
  const meta = { dados: { conta: "act_123", moeda: "BRL" }, segredos: { token: "token-da-meta-para-teste" } };
  const windsor = (fonte: Record<string, string>, escolhidas: string[] = ["123"]) => ({
    dados: { contas: { facebook: [{ id: "123", nome: "Loja" }] }, escolhidas: { facebook: escolhidas }, fonte },
    segredos: { api_key: CHAVE },
  });

  it("o padrão é a conexão própria, mesmo com a chave da Windsor salva", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-mestra-de-teste");
    const semWindsor = await provedorDoWorkspace(banco({ meta }), WS, "facebook");
    expect(semWindsor.ok && semWindsor.provedor.nome).toBe("Meta Marketing API");
    const comChave = await provedorDoWorkspace(banco({ meta, windsor: windsor({}) }), WS, "facebook");
    expect(comChave.ok && comChave.provedor.nome).toBe("Meta Marketing API");
  });

  it("quando o dono troca para a Windsor, só aquela plataforma muda", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-mestra-de-teste");
    const db = banco({ meta, windsor: windsor({ facebook: "windsor" }) });
    const facebook = await provedorDoWorkspace(db, WS, "facebook");
    expect(facebook.ok && facebook.provedor.nome).toBe("Windsor.ai");
    const tiktok = await provedorDoWorkspace(db, WS, "tiktok");
    expect(tiktok).toEqual({ ok: false, motivo: "Conecte o TikTok em Conexões para ler e mudar as campanhas." });
  });

  it("Windsor escolhida sem conta marcada não cai escondido na conexão própria: avisa o que falta", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-mestra-de-teste");
    const r = await provedorDoWorkspace(banco({ meta, windsor: windsor({ facebook: "windsor" }, []) }), WS, "facebook");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(/Escolha em Conexões/);
  });

  it("um workspace não usa a chave do outro: sem linha própria, não existe Windsor", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-mestra-de-teste");
    const r = await provedorDoWorkspace(banco({}), WS, "facebook");
    expect(r).toEqual({ ok: false, motivo: "Conecte a Meta em Conexões para ler e mudar as campanhas." });
  });

  it("regras da fonte: valor estranho vira conexão própria e escolha fora da lista é ignorada", () => {
    expect(fonteDaPlataforma(undefined, "facebook")).toBe("propria");
    expect(fonteDaPlataforma({ fonte: { facebook: "outra-coisa" } }, "facebook")).toBe("propria");
    const d = lerDadosWindsor({ contas: { facebook: [{ id: "1", nome: "A" }] }, escolhidas: { facebook: ["1", "2"] }, fonte: { facebook: "windsor" } });
    expect(d.escolhidas.facebook).toEqual(["1"]);
    expect(d.fonte).toMatchObject({ facebook: "windsor", google_ads: "propria", tiktok: "propria", presenca: "propria" });
  });

  it("a conta fica no formato dos provedores nativos, para trocar a fonte sem duplicar dados", () => {
    expect(contaCanonica("facebook", "1234567890")).toBe("act_1234567890");
    expect(contaCanonica("facebook", "act_1234567890")).toBe("act_1234567890");
    expect(contaCanonica("google_ads", "4110713742")).toBe("411-071-3742");
    expect(contaCanonica("google_ads", "411-071-3742")).toBe("411-071-3742");
    expect(contaCanonica("tiktok", "7000111")).toBe("7000111");
  });

  it("telas de tráfego: mostra a fonte de cada plataforma e o que ainda falta conectar", () => {
    const s = situacaoDe([
      { provedor: "google_ads", conectado_em: "2026-10-01T00:00:00Z" },
      { provedor: "windsor", conectado_em: "2026-10-07T00:00:00Z", dados: windsor({ facebook: "windsor", tiktok: "windsor" }).dados },
    ]);
    expect(s.fontes).toEqual({ google_ads: "propria", facebook: "windsor", tiktok: "windsor" });
    // TikTok está na Windsor mas sem conta marcada: continua aparecendo como "falta conectar".
    expect(s.semConexao.map((f) => f.nome)).toEqual(["TikTok Ads"]);
  });
});

describe("Presença no Google pela Windsor (só leitura)", () => {
  it("avaliações: estrelas por extenso ou em número, mais recentes primeiro, sem repetir", () => {
    const a = avaliacoesDaWindsor([
      { review_id: "r1", review_reviewer: "Ana", review_star_rating: "FIVE", review_comment: "Ótimo", review_create_time: "2026-09-01T10:00:00Z" },
      { review_id: "r2", review_star_rating: "4", review_create_time: "2026-10-01T10:00:00Z", review_reply_comment: "Obrigado!" },
      { review_id: "r1", review_reviewer: "Ana", review_star_rating: "FIVE", review_create_time: "2026-09-01T10:00:00Z" },
    ], { review_average_rating_total: "4.8", review_total_count: 37 });
    expect(a.media).toBe(4.8);
    expect(a.total).toBe(37);
    expect(a.lista.map((x) => [x.autor, x.estrelas, x.resposta])).toEqual([["Cliente", 4, "Obrigado!"], ["Ana", 5, null]]);
  });

  it("desempenho soma os dias; busca recalcula o CTR e ordena por cliques", () => {
    expect(desempenhoDaWindsor([
      { date: "2026-10-01", impressions: 100, website_clicks: 5, call_clicks: 1, direction_requests: 2 },
      { date: "2026-10-02", impressions: "50", website_clicks: 3, call_clicks: null, direction_requests: 1 },
    ], 28)).toEqual({ dias: 28, visualizacoes: 150, cliquesNoSite: 8, ligacoes: 1, rotas: 3 });

    expect(buscaDaWindsor([
      { query: "passeio", clicks: 2, impressions: 100, position: 8.2 },
      { query: "lençóis", clicks: 10, impressions: 200, position: 3.1 },
    ], "query", 1)).toEqual([{ chave: "lençóis", cliques: 10, impressoes: 200, ctr: 0.05, posicao: 3.1 }]);
  });
});
