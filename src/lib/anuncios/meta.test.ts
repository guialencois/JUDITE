import { describe, expect, it } from "vitest";
import { campanhaDaMeta, contaMeta, metricaDaMeta, valorDaAcao } from "./meta";

describe("provedor da Meta", () => {
  it("normaliza o ID da conta", () => {
    expect(contaMeta("123456")).toBe("act_123456");
    expect(contaMeta("act_123456")).toBe("act_123456");
  });

  it("não conta a mesma compra duas vezes quando a Meta repete em vários tipos", () => {
    const acoes = [
      { action_type: "purchase", value: "3" },
      { action_type: "omni_purchase", value: "3" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
    ];
    expect(valorDaAcao(acoes, ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"])).toBe(3);
    expect(valorDaAcao(undefined, ["purchase"])).toBeNull();
  });

  it("converte uma linha de insights", () => {
    const m = metricaDaMeta({
      date_start: "2026-10-01", campaign_id: "c1", campaign_name: "Lençóis", ad_id: "a1", ad_name: "Vídeo 1",
      spend: "42.50", impressions: "1000", clicks: "80", inline_link_clicks: "50",
      actions: [{ action_type: "link_click", value: "48" }, { action_type: "landing_page_view", value: "40" }, { action_type: "purchase", value: "2" }],
      action_values: [{ action_type: "purchase", value: "900.00" }],
    }, "act_1");
    expect(m).toMatchObject({
      data: "2026-10-01", plataforma: "facebook", contaExterna: "act_1", campanhaId: "c1", anuncioId: "a1",
      gasto: 42.5, impressoes: 1000, cliques: 48, pageViews: 40, addToCart: 0, checkout: 0, compras: 2, receita: 900,
    });
  });

  it("converte o orçamento de centavos para reais e respeita campanha sem orçamento próprio", () => {
    expect(campanhaDaMeta({ id: "c1", name: "A", status: "ACTIVE", daily_budget: "5000" }, "act_1", "BRL")?.orcamentoDiario).toBe(50);
    expect(campanhaDaMeta({ id: "c2", name: "B", status: "PAUSED" }, "act_1", "BRL")?.orcamentoDiario).toBeNull();
    expect(campanhaDaMeta({ name: "sem id" }, "act_1", "BRL")).toBeNull();
  });
});
