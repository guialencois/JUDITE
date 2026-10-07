import { describe, expect, it, vi } from "vitest";
import { ErroIA } from "@/lib/ia";
import { contexto, limites, planoDaIA, produto } from "./fixtures";
import { gerarCampanha, type Dependencias, type PedidoDeCampanha, type Proposta } from "./gerar";

const WS = "22222222-2222-4222-8222-222222222222";
const pedido = (m: Partial<PedidoDeCampanha> = {}): PedidoDeCampanha => ({ workspaceId: WS, usuarioId: "u1", modo: "automatico", ...m });

function deps(m: Partial<Dependencias> = {}) {
  const salvas: Proposta[] = [];
  const d: Dependencias = {
    iaPronta: () => true,
    motivoSemIa: () => "Falta a variável GEMINI_API_KEY no servidor.",
    carregarContexto: async () => contexto(),
    pedirPlano: vi.fn(async () => ({ dados: planoDaIA(), modelo: "gemini-teste", tokensEntrada: 10, tokensSaida: 20 })),
    salvar: async (_p, proposta) => { salvas.push(proposta); return { id: "rascunho-1" }; },
    agora: () => 0,
    ...m,
  };
  return { d, salvas };
}

describe("motor da CMO: geração de campanha", () => {
  it("gera a campanha completa e coloca na fila, passando por todas as etapas", async () => {
    const { d, salvas } = deps();
    const r = await gerarCampanha(d, pedido());

    expect(r.ok).toBe(true);
    expect(r.etapas.map((e) => e.etapa)).toEqual(["coleta", "analise", "decisao", "geracao", "conferencia", "fila"]);
    expect(r.etapas.every((e) => e.ok)).toBe(true);
    const { rascunho, plano } = salvas[0];
    expect(rascunho).toMatchObject({ plataforma: "google_ads", objetivo: "mensagens", orcamento_diario: 30, produto_id: produto().id });
    expect(rascunho.nome.startsWith("JUDITE")).toBe(true);
    expect(plano.oportunidade.tipo).toBe("intencao_de_busca");
    expect(plano.anuncios).toHaveLength(2);
    expect(plano.palavras_chave).toHaveLength(2); // o termo repetido (maiúsculas) é unificado
    expect(plano.por_que).toContain("pausada");
  });

  it("sem chave de IA, avisa qual variável falta e não lê nada nem chama a IA", async () => {
    const carregar = vi.fn(async () => contexto());
    const { d } = deps({ iaPronta: () => false, carregarContexto: carregar });
    const r = await gerarCampanha(d, pedido());
    expect(r).toMatchObject({ ok: false, codigo: "sem_ia" });
    expect(!r.ok && r.motivo).toContain("GEMINI_API_KEY");
    expect(carregar).not.toHaveBeenCalled();
    expect(d.pedirPlano).not.toHaveBeenCalled();
  });

  it("sem produto cadastrado, não chama a IA e explica", async () => {
    const { d } = deps({ carregarContexto: async () => contexto({ produtos: [] }) });
    const r = await gerarCampanha(d, pedido());
    expect(r).toMatchObject({ ok: false, codigo: "sem_oportunidade" });
    expect(!r.ok && r.motivo).toContain("Cadastre");
    expect(d.pedirPlano).not.toHaveBeenCalled();
  });

  it("não cria campanha duplicada: produto e canal que já têm campanha em andamento são pulados", async () => {
    const emAndamento = (plataforma: string) => ({ produto_id: produto().id, plataforma, status: "ativa", origem: "diretor", criado_em: "2026-10-01T10:00:00Z", oportunidade: null });
    const { d, salvas } = deps({ carregarContexto: async () => contexto({ campanhas: [emAndamento("google_ads")] }) });
    const r = await gerarCampanha(d, pedido());
    expect(r.ok).toBe(true);
    expect(salvas[0].rascunho.plataforma).not.toBe("google_ads");

    const tudo = deps({ carregarContexto: async () => contexto({ campanhas: ["google_ads", "facebook", "tiktok"].map(emAndamento) }) });
    const r2 = await gerarCampanha(tudo.d, pedido());
    expect(r2).toMatchObject({ ok: false, codigo: "sem_oportunidade" });
    expect(tudo.d.pedirPlano).not.toHaveBeenCalled();
  });

  it("recusa orçamento inválido pedido pela pessoa antes de qualquer trabalho", async () => {
    for (const orcamento of [0, -10, 5001, Number.NaN]) {
      const { d } = deps();
      const r = await gerarCampanha(d, pedido({ modo: "guiado", orcamento }));
      expect(r).toMatchObject({ ok: false, codigo: "orcamento" });
      expect(d.pedirPlano).not.toHaveBeenCalled();
    }
  });

  it("o orçamento pedido pela pessoa vence o da IA", async () => {
    const { d, salvas } = deps();
    await gerarCampanha(d, pedido({ modo: "guiado", orcamento: 45 }));
    expect(salvas[0].rascunho.orcamento_diario).toBe(45);
  });

  it("limite financeiro: a IA não consegue passar do teto calculado", async () => {
    const { d, salvas } = deps({ pedirPlano: async () => ({ dados: planoDaIA({ orcamento_diario: 900 }), modelo: "m", tokensEntrada: 0, tokensSaida: 0 }) });
    const r = await gerarCampanha(d, pedido());
    expect(r.ok).toBe(true);
    expect(salvas[0].rascunho.orcamento_diario).toBeLessThanOrEqual(100);
    expect(salvas[0].plano.avisos.join(" ")).toContain("reduzido");
  });

  it("limite financeiro: sem folga no mês, não propõe campanha e nem chama a IA", async () => {
    const { d } = deps({ carregarContexto: async () => contexto({ mes: { gastoNoMes: 1990, outrasCampanhasPorDia: 0, diasRestantes: 20, mensalMax: 2000 } }) });
    const r = await gerarCampanha(d, pedido());
    expect(r).toMatchObject({ ok: false, codigo: "orcamento" });
    expect(d.pedirPlano).not.toHaveBeenCalled();
  });

  it("canal bloqueado na governança nunca é escolhido", async () => {
    const { d, salvas } = deps({ carregarContexto: async () => contexto({ limites: limites({ bloqueadas: ["google_ads"] }) }) });
    await gerarCampanha(d, pedido());
    expect(salvas[0].rascunho.plataforma).not.toBe("google_ads");

    const pedindo = deps({ carregarContexto: async () => contexto({ limites: limites({ bloqueadas: ["google_ads"] }) }) });
    const r = await gerarCampanha(pedindo.d, pedido({ modo: "guiado", plataforma: "google_ads" }));
    expect(r).toMatchObject({ ok: false, codigo: "sem_oportunidade" });
    expect(!r.ok && r.motivo).toContain("bloqueado");
  });

  it("falha da IA vira mensagem clara e nada é salvo", async () => {
    const { d, salvas } = deps({ pedirPlano: async () => { throw new ErroIA("A cota grátis do Gemini acabou por agora."); } });
    const r = await gerarCampanha(d, pedido());
    expect(r).toMatchObject({ ok: false, codigo: "ia", motivo: "A cota grátis do Gemini acabou por agora." });
    expect(r.etapas.at(-1)).toMatchObject({ etapa: "geracao", ok: false });
    expect(salvas).toHaveLength(0);
  });

  it("resposta inválida da IA (fora do formato) é recusada e nada é salvo", async () => {
    const { d, salvas } = deps({ pedirPlano: async () => ({ dados: { nome: "x", orcamento_diario: "muito" }, modelo: "m", tokensEntrada: 0, tokensSaida: 0 }) });
    const r = await gerarCampanha(d, pedido());
    expect(r).toMatchObject({ ok: false, codigo: "ia" });
    expect(!r.ok && r.motivo).toContain("fora do formato");
    expect(salvas).toHaveLength(0);
  });

  it("anúncio com número inventado é descartado; a confiança não passa da calculada pelos dados", async () => {
    const inventado = { formato: "AIDA" as const, titulo: "50% de desconto hoje", descricao: "Só hoje.", cta: "Compre", texto: "Promoção de 50% para 300 pessoas." };
    const { d, salvas } = deps({ pedirPlano: async () => ({ dados: planoDaIA({ anuncios: [...planoDaIA().anuncios, inventado] }), modelo: "m", tokensEntrada: 0, tokensSaida: 0 }) });
    await gerarCampanha(d, pedido());
    const { plano } = salvas[0];
    expect(plano.anuncios.map((a) => a.titulo)).not.toContain("50% de desconto hoje");
    expect(plano.anuncios_descartados).toHaveLength(1);
    expect(plano.confianca).toBe("baixa"); // a IA disse "alta", mas não há histórico nem site
    expect(plano.avisos.join(" ")).toContain("confiança");
  });

  it("a IA não troca o canal da oportunidade escolhida", async () => {
    const { d, salvas } = deps({ pedirPlano: async () => ({ dados: planoDaIA({ plataforma: "tiktok" }), modelo: "m", tokensEntrada: 0, tokensSaida: 0 }) });
    await gerarCampanha(d, pedido());
    expect(salvas[0].rascunho.plataforma).toBe("google_ads");
    expect(salvas[0].plano.palavras_chave.length).toBeGreaterThan(0);
  });

  it("no ciclo diário, a fila cheia impede proposta nova; a pedido de uma pessoa, não", async () => {
    const pendente = (p: string) => ({ produto_id: "outro", plataforma: p, status: "aguardando_aprovacao", origem: "diretor", criado_em: "2026-10-04T10:00:00Z", oportunidade: null });
    const cheia = async () => contexto({ campanhas: [pendente("facebook"), pendente("tiktok")] });
    const diario = deps({ carregarContexto: cheia });
    expect(await gerarCampanha(diario.d, pedido({ modo: "diario", usuarioId: null }))).toMatchObject({ ok: false, codigo: "sem_oportunidade" });
    const manual = deps({ carregarContexto: cheia });
    expect((await gerarCampanha(manual.d, pedido())).ok).toBe(true);
  });

  it("falha ao salvar aparece como falha da etapa de fila", async () => {
    const { d } = deps({ salvar: async () => ({ erro: "Não foi possível salvar a proposta." }) });
    const r = await gerarCampanha(d, pedido());
    expect(r).toMatchObject({ ok: false, codigo: "fila" });
  });
});
