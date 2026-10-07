import { afterEach, describe, expect, it, vi } from "vitest";
import { conferirRascunho, type Rascunho } from "@/lib/campanhas/rascunho";
import { assinar, emitirEvento, montarEnvelope, pontePronta } from "@/lib/luniko/eventos";
import { estouroDoCanal, validarOrcamento } from "@/lib/trafego/limites";
import { lerLimites } from "@/lib/trafego/mes";
import { cicloDiario, fechamentoDe, type Abertura, type Registro } from "./ciclo";
import { orcamentoInicial } from "./financeiro";
import { contexto, produto, resumo } from "./fixtures";
import type { ResultadoDaGeracao } from "./gerar";
import { escolherParaIdeias, gerarIdeias, type DependenciasDeIdeias, type Ideia } from "./ideias";
import { nivelEfetivo, permissoes, podeDefinirNivel } from "./niveis";
import { analisarOportunidades, decidirOportunidade, DIAS_APOS_RECUSA, motivoDaDuplicidade, type CampanhaExistente } from "./oportunidades";

const AGORA = new Date("2026-10-05T12:00:00Z");
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 864e5).toISOString();
const campanha = (m: Partial<CampanhaExistente> = {}): CampanhaExistente => ({
  produto_id: produto().id, plataforma: "google_ads", status: "aguardando_aprovacao", origem: "diretor", criado_em: diasAtras(1), oportunidade: null, ...m,
});

describe("níveis de autonomia", () => {
  it("autonomia desligada: nível 1 por padrão, só propõe", () => {
    expect(nivelEfetivo(null)).toBe(1);
    expect(nivelEfetivo({ ligada: false })).toBe(1);
    expect(permissoes(1)).toEqual({ proporTodoDia: true, ajustarVerbaSozinha: false, criarCampanhaSemAprovacao: false, ativarCampanhaSemAprovacao: false });
    expect(permissoes(0).proporTodoDia).toBe(false);
  });

  it("autonomia ligada: nível 2 ajusta verba, mas nunca cria nem ativa campanha sem aprovação", () => {
    expect(nivelEfetivo({ ligada: true })).toBe(2);
    expect(nivelEfetivo({ ligada: true, nivel: 2 })).toBe(2);
    expect(permissoes(2)).toMatchObject({ ajustarVerbaSozinha: true, criarCampanhaSemAprovacao: false, ativarCampanhaSemAprovacao: false });
  });

  it("\"Parar tudo\" (ligada = false) derruba para o nível 1 mesmo com nível 2 gravado", () => {
    expect(nivelEfetivo({ ligada: false, nivel: 2 })).toBe(1);
    expect(nivelEfetivo({ ligada: false, nivel: 0 })).toBe(0);
  });

  it("níveis 3 e 4 não ligam: nem pela tela, nem gravando direto no banco", () => {
    expect(nivelEfetivo({ ligada: true, nivel: 4 })).toBe(2);
    expect(podeDefinirNivel(3, "owner", true)).toContain("não está liberado");
    expect(podeDefinirNivel(4, "owner", true)).toContain("não está liberado");
    expect(permissoes(4 as never).criarCampanhaSemAprovacao).toBe(false);
  });

  it("só o dono muda o nível, e o nível 2 exige a confirmação", () => {
    expect(podeDefinirNivel(1, "admin", true)).toContain("dono");
    expect(podeDefinirNivel(2, "owner", false)).toContain("marque a caixa");
    expect(podeDefinirNivel(2, "owner", true)).toBeNull();
    expect(podeDefinirNivel(0, "owner", false)).toBeNull();
    expect(podeDefinirNivel(7, "owner", true)).toContain("inválido");
  });
});

describe("limites financeiros", () => {
  it("lê os limites novos com padrões seguros", () => {
    const l = lerLimites([{ chave: "mensal_max_facebook", valor: 600 }, { chave: "bloqueada_tiktok", valor: 1 }]);
    expect(l.reducaoMaxPercent).toBe(50);
    expect(l.mensalPorCanal).toEqual({ google_ads: 0, facebook: 600, tiktok: 0 });
    expect(l.bloqueadas).toEqual(["tiktok"]);
    expect(lerLimites(null).bloqueadas).toEqual([]);
  });

  it("redução maior que o limite pede aprovação; dentro do limite passa", () => {
    const e = { atualReais: 100, maxSemAprovacao: 200, reducaoMaxPercent: 30 };
    expect(validarOrcamento({ ...e, novoReais: 70 }).precisaAprovacao).toBe(false);
    expect(validarOrcamento({ ...e, novoReais: 69 })).toMatchObject({ ok: true, precisaAprovacao: true });
    expect(validarOrcamento({ atualReais: 100, maxSemAprovacao: 200, novoReais: 10 }).precisaAprovacao).toBe(false); // sem limite informado
  });

  it("teto por canal: avisa quando a projeção do canal passa do teto", () => {
    const canal = { gastoNoMes: 400, outrasCampanhasPorDia: 10, diasRestantes: 10, mensalMax: 600 };
    expect(estouroDoCanal(canal, 5, "Meta Ads")).toBeNull();
    expect(estouroDoCanal(canal, 20, "Meta Ads")).toContain("Meta Ads");
    expect(estouroDoCanal({ ...canal, mensalMax: 0 }, 9999, "Meta Ads")).toBeNull();
  });

  it("o rascunho leva o aviso do teto do canal", () => {
    const r: Rascunho = {
      plataforma: "facebook", nome: "JUDITE - teste", objetivo: "mensagens", orcamento_diario: 40,
      publico: { regiao: "", idade_min: null, idade_max: null, interesses: "" }, produto_id: null, criativo_ids: [], justificativa: "",
    };
    const conferido = conferirRascunho(r, {
      maxSemAprovacao: 100, mes: { gastoNoMes: 0, outrasCampanhasPorDia: 0, diasRestantes: 10, mensalMax: 2000 },
      canal: { gastoNoMes: 300, outrasCampanhasPorDia: 0, diasRestantes: 10, mensalMax: 500 },
      plataformasConectadas: ["meta"], criativosValidos: [],
    });
    expect(conferido.erro).toBeNull();
    expect(conferido.avisos.join(" ")).toContain("teto do canal");
  });

  it("orçamento inicial: conservador, nunca acima do teto diário nem da folga do mês", () => {
    const folgado = orcamentoInicial({ maxSemAprovacao: 100, mes: { gastoNoMes: 0, outrasCampanhasPorDia: 0, diasRestantes: 27, mensalMax: 2000 } });
    expect(folgado).toMatchObject({ recomendado: 30, teto: 74 });
    const apertado = orcamentoInicial({ maxSemAprovacao: 100, mes: { gastoNoMes: 1500, outrasCampanhasPorDia: 10, diasRestantes: 20, mensalMax: 2000 } });
    expect(apertado.teto).toBe(15);
    expect(apertado.recomendado).toBeLessThanOrEqual(apertado.teto);
    const semFolga = orcamentoInicial({ maxSemAprovacao: 100, mes: { gastoNoMes: 1990, outrasCampanhasPorDia: 0, diasRestantes: 20, mensalMax: 2000 } });
    expect(semFolga.recomendado).toBe(0);
    expect(semFolga.explicacao).toContain("Não cabe");
    const canal = orcamentoInicial({
      maxSemAprovacao: 100, mes: { gastoNoMes: 0, outrasCampanhasPorDia: 0, diasRestantes: 10, mensalMax: 5000 },
      canal: { gastoNoMes: 0, outrasCampanhasPorDia: 0, diasRestantes: 10, mensalMax: 200 },
    });
    expect(canal.teto).toBe(20);
  });
});

describe("oportunidades", () => {
  const entrada = (m = {}) => ({ produtos: [produto()], campanhas: [] as CampanhaExistente[], resumo: resumo(), bloqueadas: [], agora: AGORA, ...m });

  it("campanha duplicada: mesma combinação em andamento ou recusada há pouco é barrada", () => {
    const id = produto().id;
    expect(motivoDaDuplicidade([campanha()], id, "google_ads", "intencao_de_busca", AGORA)).toContain("em andamento");
    expect(motivoDaDuplicidade([campanha({ status: "pausada_pela_ia" })], id, "google_ads", "intencao_de_busca", AGORA)).toContain("em andamento");
    expect(motivoDaDuplicidade([campanha({ status: "recusada", criado_em: diasAtras(3) })], id, "google_ads", "intencao_de_busca", AGORA)).toContain("recusou");
    expect(motivoDaDuplicidade([campanha({ status: "recusada", criado_em: diasAtras(DIAS_APOS_RECUSA + 1) })], id, "google_ads", "intencao_de_busca", AGORA)).toBeNull();
    expect(motivoDaDuplicidade([campanha({ status: "concluida" })], id, "google_ads", "intencao_de_busca", AGORA)).toBeNull();
    expect(motivoDaDuplicidade([campanha()], id, "facebook", "geracao_de_demanda", AGORA)).toBeNull();
    // Com a oportunidade gravada, outra ideia no mesmo canal não é duplicata.
    expect(motivoDaDuplicidade([campanha({ plataforma: "facebook", oportunidade: "remarketing" })], id, "facebook", "geracao_de_demanda", AGORA)).toBeNull();
  });

  it("remarketing só existe com visitas suficientes no site", () => {
    expect(analisarOportunidades(entrada()).some((o) => o.tipo === "remarketing")).toBe(false);
    const comSite = resumo({ site: { dominio: "guialencois.org", dias: 7, visitantes: 350, visualizacoes: 900, cliques_whatsapp: 12, conversao_whatsapp: 0.03, origens: [], paginas: [] } });
    const lista = analisarOportunidades(entrada({ resumo: comSite }));
    const remarketing = lista.find((o) => o.tipo === "remarketing" && o.plataforma === "facebook");
    expect(remarketing?.dados.join(" ")).toContain("350 visitantes");
    expect(remarketing?.confianca).toBe("media");
  });

  it("toda oportunidade é explicável: motivo, dados e ressalvas", () => {
    for (const o of analisarOportunidades(entrada())) {
      expect(o.motivo.length).toBeGreaterThan(20);
      expect(o.dados.length + o.ressalvas.length).toBeGreaterThan(0);
      expect(o.chave).toBe(`${o.tipo}:${o.produto.id}:${o.plataforma}`);
    }
  });

  it("a ordem é estável e respeita filtro e bloqueio", () => {
    const a = analisarOportunidades(entrada()).map((o) => o.chave);
    expect(analisarOportunidades(entrada()).map((o) => o.chave)).toEqual(a);
    expect(analisarOportunidades(entrada({ bloqueadas: ["facebook", "tiktok"] })).every((o) => o.plataforma === "google_ads")).toBe(true);
    expect(analisarOportunidades(entrada({ filtro: { plataforma: "tiktok" } })).every((o) => o.plataforma === "tiktok")).toBe(true);
  });

  it("decisão: sem produto ou com produto inexistente, explica em vez de propor", () => {
    expect(decidirOportunidade(entrada({ produtos: [] }), { respeitarFila: true })).toMatchObject({ oportunidade: null });
    const r = decidirOportunidade(entrada({ filtro: { produtoId: "nao-existe" } }), { respeitarFila: false });
    expect(r.oportunidade).toBeNull();
  });
});

describe("ciclo diário", () => {
  const proposta: ResultadoDaGeracao = { ok: true, rascunhoId: "r1", nome: "JUDITE - teste", produto: "Passeio", etapas: [] };
  function registroEmMemoria() {
    const abertos = new Set<string>();
    const fechados: unknown[] = [];
    const registro: Registro = {
      async abrir(): Promise<Abertura> {
        if (abertos.has("hoje")) return { situacao: "duplicada" };
        abertos.add("hoje");
        return { situacao: "aberta", id: "x1" };
      },
      async fechar(_id, f) { fechados.push(f); },
    };
    return { registro, fechados };
  }

  it("idempotência: se o cron disparar duas vezes no dia, só a primeira gera proposta", async () => {
    const { registro, fechados } = registroEmMemoria();
    const gerar = vi.fn(async () => proposta);
    const deps = { nivel: async () => 1 as const, registro, monitorar: async () => "ok", gerar };
    expect(await cicloDiario(deps)).toMatchObject({ rodou: true });
    expect(await cicloDiario(deps)).toMatchObject({ rodou: false, motivo: "O ciclo de hoje já rodou para este workspace." });
    expect(gerar).toHaveBeenCalledTimes(1);
    expect(fechados).toHaveLength(1);
    expect(fechados[0]).toMatchObject({ status: "ok", rascunhoId: "r1" });
  });

  it("nível 0 (manual): o ciclo não propõe nada nem abre registro", async () => {
    const { registro } = registroEmMemoria();
    const gerar = vi.fn(async () => proposta);
    const r = await cicloDiario({ nivel: async () => 0, registro, monitorar: async () => "ok", gerar });
    expect(r.rodou).toBe(false);
    expect(gerar).not.toHaveBeenCalled();
  });

  it("uma falha no monitoramento não impede a proposta e fica registrada", async () => {
    const { registro, fechados } = registroEmMemoria();
    const r = await cicloDiario({ nivel: async () => 2, registro, monitorar: async () => { throw new Error("x"); }, gerar: async () => proposta });
    expect(r.rodou).toBe(true);
    expect((fechados[0] as { etapas: { etapa: string; ok: boolean }[] }).etapas[0]).toMatchObject({ etapa: "monitoramento", ok: false });
  });

  it("\"não havia o que propor\" não é erro", () => {
    expect(fechamentoDe({ ok: false, codigo: "sem_oportunidade", motivo: "Nada novo.", etapas: [] }).status).toBe("sem_proposta");
    expect(fechamentoDe({ ok: false, codigo: "ia", motivo: "Falha.", etapas: [] }).status).toBe("erro");
  });
});

describe("modo \"Quero ideias\"", () => {
  function deps(resposta: unknown, m: Partial<DependenciasDeIdeias> = {}) {
    const salvas: Ideia[] = [];
    const d: DependenciasDeIdeias = {
      iaPronta: () => true, motivoSemIa: () => "Falta a variável GEMINI_API_KEY no servidor.",
      carregarContexto: async () => contexto(),
      pedirIdeias: async () => ({ dados: resposta, modelo: "m", tokensEntrada: 0, tokensSaida: 0 }),
      salvar: async (_ws, _u, ideias) => { salvas.push(...ideias); return null; },
      ...m,
    };
    return { d, salvas };
  }
  const chaves = escolherParaIdeias(analisarOportunidades({ produtos: [produto()], campanhas: [], resumo: resumo(), bloqueadas: [] })).map((o) => o.chave);
  const texto = (chave: string) => ({ chave, titulo: "Campanha para quem pesquisa o passeio", publico: "Viajantes", estrategia: "Busca.", hipotese: "Se..., então...", por_que: "Há intenção." });

  it("devolve até 3 ideias, uma por produto e canal, com orçamento calculado pelo código", async () => {
    expect(chaves.length).toBe(3);
    const { d, salvas } = deps({ ideias: chaves.map(texto) });
    expect(await gerarIdeias(d, "ws", "u1")).toEqual({ ok: true, quantidade: 3 });
    expect(new Set(salvas.map((i) => i.plataforma)).size).toBe(3);
    expect(salvas.every((i) => i.orcamentoSugerido === 30)).toBe(true);
  });

  it("ideia que a IA inventa fora da lista é ignorada", async () => {
    const { d, salvas } = deps({ ideias: [texto(chaves[0]), texto("inventada:xyz:facebook")] });
    expect(await gerarIdeias(d, "ws", "u1")).toEqual({ ok: true, quantidade: 1 });
    expect(salvas).toHaveLength(1);
  });

  it("sem chave, sem produto ou com resposta inválida, explica e não salva", async () => {
    expect(await gerarIdeias(deps({}, { iaPronta: () => false }).d, "ws", null)).toMatchObject({ ok: false, motivo: expect.stringContaining("GEMINI_API_KEY") });
    expect(await gerarIdeias(deps({}, { carregarContexto: async () => contexto({ produtos: [] }) }).d, "ws", null)).toMatchObject({ ok: false });
    const invalida = deps({ ideias: "nenhuma" });
    expect(await gerarIdeias(invalida.d, "ws", null)).toMatchObject({ ok: false, motivo: expect.stringContaining("fora do formato") });
    expect(invalida.salvas).toHaveLength(0);
  });
});

describe("ponte com o LUNIKO", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("desligada por padrão: sem as variáveis nada é enviado", async () => {
    vi.stubEnv("LUNIKO_WEBHOOK_URL", "");
    vi.stubEnv("LUNIKO_WEBHOOK_SECRET", "");
    const falso = vi.fn();
    vi.stubGlobal("fetch", falso);
    expect(pontePronta()).toBe(false);
    expect((await emitirEvento("campanha.estado_mudou", {})).enviado).toBe(false);
    expect(falso).not.toHaveBeenCalled();
  });

  it("assina o corpo com HMAC e manda o id do evento para idempotência", async () => {
    vi.stubEnv("LUNIKO_WEBHOOK_URL", "https://luniko.exemplo/webhooks/judite");
    vi.stubEnv("LUNIKO_WEBHOOK_SECRET", "segredo-de-teste");
    const falso = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", falso);
    expect((await emitirEvento("campanha.estado_mudou", { campanha_id: "c1", para: "ativa" })).enviado).toBe(true);
    const [, init] = falso.mock.calls[0];
    const cabecalhos = init?.headers as Record<string, string>;
    const corpo = String(init?.body);
    expect(cabecalhos["x-judite-assinatura"]).toBe(assinar(corpo, cabecalhos["x-judite-timestamp"], "segredo-de-teste"));
    expect(JSON.parse(corpo)).toMatchObject({ id: cabecalhos["x-judite-evento"], tipo: "campanha.estado_mudou", versao: "1", dados: { campanha_id: "c1" } });
    expect(corpo).not.toContain("segredo-de-teste");
  });

  it("falha do LUNIKO não vira exceção", async () => {
    vi.stubEnv("LUNIKO_WEBHOOK_URL", "https://luniko.exemplo/x");
    vi.stubEnv("LUNIKO_WEBHOOK_SECRET", "s");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede"); }));
    expect(await emitirEvento("campanha.estado_mudou", {})).toMatchObject({ enviado: false });
    expect(montarEnvelope("campanha.estado_mudou", {}, new Date("2026-10-05T00:00:00Z")).emitido_em).toBe("2026-10-05T00:00:00.000Z");
  });
});
