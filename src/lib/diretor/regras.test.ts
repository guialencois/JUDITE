import { describe, expect, it } from "vitest";
import { aplicarRegras, motivoDoDescarte } from "./regras";
import { construirResumo, deslocar, type DadosBrutos } from "./resumo";
import type { CampanhaResumo, RecomendacaoIA, ResumoDiretor } from "./tipos";
import type { LinhaMetrica } from "@/lib/trafego/tipos";

const campanha = (m: Partial<CampanhaResumo> = {}): CampanhaResumo => ({
  plataforma: "facebook", campanha_id: "c1", nome: "Lençóis", status: "ACTIVE", ativa: true, orcamento_diario: 50,
  gasto: 400, impressoes: 20000, cliques: 300, compras: 8, receita: 0, dias_com_dados: 14, ctr: 0.015, cpc: 1.33, ...m,
});

const resumo = (campanhas: CampanhaResumo[]): ResumoDiretor => ({
  hoje: "2026-10-04", janela: { dias: 14, de: "2026-09-20", ate: "2026-10-03" }, conexoes: [],
  trafego: {
    periodo_atual: { gasto: 0, impressoes: 0, cliques: 0, compras: 0, receita: 0 },
    periodo_anterior: { gasto: 0, impressoes: 0, cliques: 0, compras: 0, receita: 0 },
    por_plataforma: [],
  },
  campanhas, site: null,
  comercial: { mes: "2026-10", faturamento: 0, vendas: 0, ticket_medio: null, roas_real: null, cac: null, por_produto: [] },
  metas: [],
  limites: { orcamento_diario_max_sem_aprovacao: 100, aumento_max_por_ajuste_percent: 10, orcamento_mensal_max: 2000, gasto_no_mes: 0, dias_restantes_no_mes: 28 },
  regras: { dias_minimos_de_dados: 7, cliques_minimos: 100, conversoes_minimas_para_aumentar: 5 },
  avisos: [],
});

const rec = (m: Partial<RecomendacaoIA> = {}): RecomendacaoIA => ({
  tipo: "ajustar_orcamento", titulo: "Aumentar verba", justificativa: "Porque converte bem.", impacto_esperado: "Tende a trazer mais contatos.",
  prioridade: "media", plataforma: "facebook", campanha_id: "c1", valor_sugerido: 55, ...m,
});

describe("regras de prudência do Diretor", () => {
  it("aceita ajuste de verba com dados suficientes", () => {
    expect(motivoDoDescarte(rec(), resumo([campanha()]))).toBeNull();
  });

  it("barra recomendação de verba para campanha que não existe nos dados", () => {
    expect(motivoDoDescarte(rec({ campanha_id: "inventada" }), resumo([campanha()]))).toContain("não existe");
    expect(motivoDoDescarte(rec({ campanha_id: null }), resumo([campanha()]))).toContain("qual campanha");
  });

  it("respeita o período de aprendizado e o volume mínimo de cliques", () => {
    expect(motivoDoDescarte(rec(), resumo([campanha({ dias_com_dados: 3 })]))).toContain("período de aprendizado");
    expect(motivoDoDescarte(rec(), resumo([campanha({ cliques: 40 })]))).toContain("cliques");
    expect(motivoDoDescarte(rec({ tipo: "pausar_campanha", valor_sugerido: null }), resumo([campanha({ cliques: 40 })]))).toContain("cliques");
  });

  it("só deixa aumentar verba com conversões mínimas; reduzir não exige", () => {
    const poucas = resumo([campanha({ compras: 1 })]);
    expect(motivoDoDescarte(rec({ valor_sugerido: 55 }), poucas)).toContain("conversões");
    expect(motivoDoDescarte(rec({ valor_sugerido: 40 }), poucas)).toBeNull();
  });

  it("barra valor ausente, acima do teto absoluto ou igual ao atual", () => {
    const r = resumo([campanha()]);
    expect(motivoDoDescarte(rec({ valor_sugerido: null }), r)).toContain("novo valor");
    expect(motivoDoDescarte(rec({ valor_sugerido: 9000 }), r)).toContain("teto absoluto");
    expect(motivoDoDescarte(rec({ valor_sugerido: 50 }), r)).toContain("igual");
  });

  it("não pausa o que já está pausado nem ativa o que já está ativo", () => {
    expect(motivoDoDescarte(rec({ tipo: "pausar_campanha" }), resumo([campanha({ ativa: false })]))).toContain("já está pausada");
    expect(motivoDoDescarte(rec({ tipo: "ativar_campanha" }), resumo([campanha()]))).toContain("já está ativa");
  });

  it("recomendações que não mexem em verba passam, sem valor nem campanha", () => {
    const { aceitas, descartadas } = aplicarRegras(
      [rec({ tipo: "site", campanha_id: null, plataforma: null, valor_sugerido: 123 }), rec({ campanha_id: "x" }), rec({ titulo: " " })],
      resumo([campanha()]),
    );
    expect(aceitas).toHaveLength(1);
    expect(aceitas[0].valor_sugerido).toBeNull();
    expect(descartadas).toHaveLength(2);
  });
});

describe("resumo enviado ao Diretor", () => {
  const linha = (data: string, m: Partial<LinhaMetrica> = {}): LinhaMetrica => ({
    data, plataforma: "facebook", contaExterna: "act_1", campanhaId: "c1", campanha: "Lençóis", anuncioId: "a1", anuncio: "Vídeo",
    gasto: 10, impressoes: 1000, cliques: 20, pageViews: 15, addToCart: 0, checkout: 0, compras: 1, receita: 0, ...m,
  });
  const base: DadosBrutos = {
    hoje: "2026-10-04", metricas: [], campanhas: [], conexoesProntas: [], site: null, eventosSite: [],
    vendasDoMes: [], metas: [], config: [], gastoNoMes: 0,
  };

  it("avisa o que está faltando em vez de inventar número", () => {
    const r = construirResumo(base);
    expect(r.avisos.join(" ")).toContain("Nenhuma plataforma");
    expect(r.avisos.join(" ")).toContain("Nenhuma venda");
    expect(r.comercial.roas_real).toBeNull();
    expect(r.site).toBeNull();
  });

  it("separa a janela atual da anterior e conta os dias com dados de cada campanha", () => {
    const r = construirResumo({
      ...base,
      metricas: [linha("2026-10-03"), linha("2026-10-02"), linha("2026-09-10"), linha("2026-10-04")],
      campanhas: [{ plataforma: "facebook", campanha_id: "c1", nome: "Lençóis", status: "ACTIVE", orcamento_diario: 50 }],
      conexoesProntas: ["meta"],
    });
    expect(r.janela).toEqual({ dias: 14, de: "2026-09-20", ate: "2026-10-03" });
    expect(r.trafego.periodo_atual.gasto).toBe(20);
    expect(r.trafego.periodo_anterior.gasto).toBe(10);
    expect(r.campanhas[0]).toMatchObject({ dias_com_dados: 2, cliques: 40, ativa: true, cpc: 0.5 });
    expect(r.conexoes.find((c) => c.plataforma === "Meta Ads")?.conectada).toBe(true);
  });

  it("desloca datas sem errar na virada do mês", () => {
    expect(deslocar("2026-10-01", -1)).toBe("2026-09-30");
    expect(deslocar("2026-12-31", 1)).toBe("2027-01-01");
  });
});
