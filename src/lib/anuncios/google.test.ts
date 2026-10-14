import { describe, expect, it } from "vitest";
import { campanhaDoGoogle, erroDoGoogle, metricaDoGoogle } from "./google";

describe("provedor do Google Ads", () => {
  it("converte micros para reais e marca como não informadas as métricas que o Google não tem", () => {
    const m = metricaDoGoogle({
      segments: { date: "2026-10-01" },
      campaign: { id: "123", name: "Pesquisa Lençóis" },
      metrics: { costMicros: "45670000", impressions: "900", clicks: "30", conversions: 2.5, conversionsValue: 800 },
    }, "411-071-3742");
    expect(m).toMatchObject({
      data: "2026-10-01", plataforma: "google_ads", contaExterna: "411-071-3742", campanhaId: "123",
      gasto: 45.67, impressoes: 900, cliques: 30, compras: 2.5, receita: 800,
      pageViews: null, addToCart: null, checkout: null,
    });
  });

  it("lê status e orçamento da campanha", () => {
    const c = campanhaDoGoogle({
      campaign: { id: "123", name: "A", status: "ENABLED" },
      campaignBudget: { amountMicros: "50000000" },
      customer: { currencyCode: "BRL" },
    }, "411-071-3742");
    expect(c).toMatchObject({ campanhaId: "123", status: "ENABLED", orcamentoDiario: 50, moeda: "BRL" });
    expect(campanhaDoGoogle({ campaign: { id: "9", name: "sem verba" } }, "x")?.orcamentoDiario).toBeNull();
  });

  it("explica com clareza quando o developer token ainda não foi aprovado", () => {
    const mensagem = erroDoGoogle({
      error: {
        code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED",
        details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" }, message: "The developer token is only approved for use with test accounts." }] }],
      },
    });
    expect(mensagem).toContain("acesso de teste");
    expect(erroDoGoogle({ results: [] })).toBeNull();
  });
});
