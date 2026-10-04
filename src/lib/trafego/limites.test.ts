import { describe, expect, it } from "vitest";
import { estouroMensal, projecaoDoMes, TETO_ABSOLUTO_REAIS, validarAtivacao, validarOrcamento, type SituacaoDoMes } from "./limites";
import { diasRestantesNoMes, hojeEmBrasilia, lerLimites, limitesDoMes, mesVizinho } from "./mes";

const mes = (m: Partial<SituacaoDoMes> = {}): SituacaoDoMes => ({
  gastoNoMes: 500, outrasCampanhasPorDia: 20, diasRestantes: 10, mensalMax: 2000, ...m,
});

describe("freios de orçamento", () => {
  it("recusa valor zero, negativo ou acima do teto absoluto", () => {
    expect(validarOrcamento({ atualReais: 50, novoReais: 0, maxSemAprovacao: 100 }).ok).toBe(false);
    expect(validarOrcamento({ atualReais: 50, novoReais: -5, maxSemAprovacao: 100 }).ok).toBe(false);
    expect(validarOrcamento({ atualReais: 50, novoReais: TETO_ABSOLUTO_REAIS + 1, maxSemAprovacao: 10000 }).ok).toBe(false);
  });

  it("pede aprovação acima do teto diário sem aprovação", () => {
    const c = validarOrcamento({ atualReais: 95, novoReais: 101, maxSemAprovacao: 100 });
    expect(c).toMatchObject({ ok: true, precisaAprovacao: true });
  });

  it("aceita aumento de até 10% por padrão e pede aprovação acima disso", () => {
    expect(validarOrcamento({ atualReais: 50, novoReais: 55, maxSemAprovacao: 100 }).precisaAprovacao).toBe(false);
    expect(validarOrcamento({ atualReais: 50, novoReais: 55.01, maxSemAprovacao: 100 }).precisaAprovacao).toBe(true);
    expect(validarOrcamento({ atualReais: 50, novoReais: 70, maxSemAprovacao: 100, aumentoMaxPercent: 50 }).precisaAprovacao).toBe(false);
  });

  it("pede aprovação quando não sabe o orçamento atual", () => {
    expect(validarOrcamento({ atualReais: null, novoReais: 30, maxSemAprovacao: 100 }).precisaAprovacao).toBe(true);
  });

  it("reduzir verba nunca pede aprovação, mesmo com o mês estourado", () => {
    const c = validarOrcamento({ atualReais: 50, novoReais: 30, maxSemAprovacao: 100, mes: mes({ gastoNoMes: 5000 }) });
    expect(c).toMatchObject({ ok: true, precisaAprovacao: false, valorFinal: 30 });
  });
});

describe("freio mensal", () => {
  it("projeta o gasto do mês: já gasto + (outras campanhas + esta) x dias restantes", () => {
    expect(projecaoDoMes(mes(), 30)).toBe(500 + (20 + 30) * 10);
  });

  it("aumento que cabe no mês passa; aumento que estoura vira aprovação", () => {
    // 500 + (20 + 55) * 10 = 1250 <= 2000
    expect(validarOrcamento({ atualReais: 50, novoReais: 55, maxSemAprovacao: 100, mes: mes() }).precisaAprovacao).toBe(false);
    // 1500 + (20 + 55) * 10 = 2250 > 2000
    const c = validarOrcamento({ atualReais: 50, novoReais: 55, maxSemAprovacao: 100, mes: mes({ gastoNoMes: 1500 }) });
    expect(c.precisaAprovacao).toBe(true);
    expect(c.motivo).toContain("orcamento mensal");
  });

  it("teto mensal zero ou ausente não bloqueia nada", () => {
    expect(estouroMensal(mes({ mensalMax: 0, gastoNoMes: 99999 }), 100)).toBeNull();
  });

  it("ligar campanha confere o mês com o orçamento diário dela", () => {
    expect(validarAtivacao(50, mes()).precisaAprovacao).toBe(false);
    expect(validarAtivacao(200, mes()).precisaAprovacao).toBe(true);
    // Sem orçamento conhecido: só barra se o mês já estourou.
    expect(validarAtivacao(null, mes()).precisaAprovacao).toBe(false);
    expect(validarAtivacao(null, mes({ gastoNoMes: 2000 })).precisaAprovacao).toBe(true);
  });
});

describe("datas do mês", () => {
  it("calcula limites, dias restantes e mês vizinho", () => {
    expect(limitesDoMes("2026-02")).toEqual({ inicio: "2026-02-01", fim: "2026-02-28", dias: 28 });
    expect(limitesDoMes("2028-02").dias).toBe(29);
    expect(diasRestantesNoMes("2026-10-04")).toBe(28);
    expect(diasRestantesNoMes("2026-10-31")).toBe(1);
    expect(mesVizinho("2026-01", -1)).toBe("2025-12");
    expect(mesVizinho("2026-12", 1)).toBe("2027-01");
  });

  it("usa o dia de Brasília, não o de UTC", () => {
    // 02h em UTC do dia 1º ainda é dia 31 em Brasília (UTC-3).
    expect(hojeEmBrasilia(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
  });

  it("usa padrões seguros quando o limite não está gravado", () => {
    expect(lerLimites([])).toEqual({ maxSemAprovacao: 100, aumentoMaxPercent: 10, mensalMax: 2000, custosPercent: 25 });
    expect(lerLimites([{ chave: "orcamento_mensal_max", valor: "3500.00" }]).mensalMax).toBe(3500);
  });
});
