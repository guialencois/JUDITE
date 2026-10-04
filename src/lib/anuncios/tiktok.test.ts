import { describe, expect, it } from "vitest";
import { campanhaDoTikTok, erroDoTikTok, janelas, metricaDoTikTok } from "./tiktok";

describe("provedor do TikTok", () => {
  it("quebra períodos longos em janelas de até 30 dias, sem buraco e sem repetir dia", () => {
    expect(janelas("2026-08-05", "2026-10-03")).toEqual([
      { de: "2026-08-05", ate: "2026-09-03" },
      { de: "2026-09-04", ate: "2026-10-03" },
    ]);
    expect(janelas("2026-10-01", "2026-10-03")).toEqual([{ de: "2026-10-01", ate: "2026-10-03" }]);
    expect(janelas("2026-10-03", "2026-10-01")).toEqual([]);
  });

  it("converte uma linha do relatório", () => {
    const m = metricaDoTikTok({
      dimensions: { ad_id: "77", stat_time_day: "2026-10-01 00:00:00" },
      metrics: { campaign_id: "5", campaign_name: "Lençóis", ad_name: "Vídeo", spend: "30.5", impressions: "2000", clicks: "40", conversion: "3" },
    }, "700123");
    expect(m).toMatchObject({
      data: "2026-10-01", plataforma: "tiktok", contaExterna: "700123", campanhaId: "5", anuncioId: "77",
      gasto: 30.5, impressoes: 2000, cliques: 40, compras: 3, receita: 0, pageViews: null,
    });
  });

  it("só trata como orçamento diário a campanha com verba por dia", () => {
    expect(campanhaDoTikTok({ campaign_id: "5", campaign_name: "A", operation_status: "ENABLE", budget_mode: "BUDGET_MODE_DAY", budget: 80 }, "1", "BRL")?.orcamentoDiario).toBe(80);
    expect(campanhaDoTikTok({ campaign_id: "6", budget_mode: "BUDGET_MODE_TOTAL", budget: 900 }, "1", "BRL")?.orcamentoDiario).toBeNull();
    expect(campanhaDoTikTok({ campaign_id: "7", budget_mode: "BUDGET_MODE_INFINITE", budget: 0 }, "1", "BRL")?.orcamentoDiario).toBeNull();
  });

  it("entende o formato de erro do TikTok (HTTP 200 com code diferente de zero)", () => {
    expect(erroDoTikTok({ code: 0, message: "OK", data: {} })).toBeNull();
    expect(erroDoTikTok({ code: 40002, message: "Invalid metric" })).toContain("40002");
    expect(erroDoTikTok({ code: 40105, message: "token expired" })).toContain("Autorize de novo");
  });
});
