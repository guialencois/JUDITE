import { describe, expect, it } from "vitest";
import {
  avaliacaoValida, avaliacoesDe, contaValida, desempenhoDe, erroDoGoogleApis, linhasDeBusca, localValido, siteGscValido,
} from "./google";
import { lacunasDoPerfil } from "./painel";

describe("Presença no Google", () => {
  it("valida os identificadores antes de usar em URLs", () => {
    expect(contaValida("accounts/123")).toBe(true);
    expect(contaValida("accounts/123/../x")).toBe(false);
    expect(localValido("locations/456")).toBe(true);
    expect(localValido("locations/abc")).toBe(false);
    expect(avaliacaoValida("accounts/1/locations/2/reviews/AbC-123_x")).toBe(true);
    expect(avaliacaoValida("accounts/1/locations/2/reviews/../../x")).toBe(false);
    expect(siteGscValido("https://www.guialencois.org/")).toBe(true);
    expect(siteGscValido("sc-domain:guialencois.org")).toBe(true);
    expect(siteGscValido("javascript:alert(1)")).toBe(false);
  });

  it("converte avaliações (estrelas por extenso viram número)", () => {
    const a = avaliacoesDe({
      averageRating: 4.8, totalReviewCount: 37,
      reviews: [
        { name: "accounts/1/locations/2/reviews/x", reviewer: { displayName: "Ana" }, starRating: "FIVE", comment: "Ótimo passeio", createTime: "2026-09-30T10:00:00Z" },
        { name: "accounts/1/locations/2/reviews/y", starRating: "TWO", reviewReply: { comment: "Sentimos muito." } },
      ],
    });
    expect(a.media).toBe(4.8);
    expect(a.total).toBe(37);
    expect(a.lista[0]).toMatchObject({ autor: "Ana", estrelas: 5, comentario: "Ótimo passeio", resposta: null });
    expect(a.lista[1]).toMatchObject({ autor: "Cliente", estrelas: 2, comentario: null, resposta: "Sentimos muito." });
  });

  it("soma as séries diárias de desempenho do perfil", () => {
    const serie = (dailyMetric: string, valores: (string | undefined)[]) => ({
      dailyMetric, timeSeries: { datedValues: valores.map((value) => ({ date: { year: 2026, month: 10, day: 1 }, value })) },
    });
    const d = desempenhoDe({
      multiDailyMetricTimeSeries: [{
        dailyMetricTimeSeries: [
          serie("BUSINESS_IMPRESSIONS_MOBILE_SEARCH", ["10", "5"]),
          serie("BUSINESS_IMPRESSIONS_DESKTOP_MAPS", ["3", undefined]),
          serie("WEBSITE_CLICKS", ["4"]),
          serie("CALL_CLICKS", ["2"]),
        ],
      }],
    }, 28);
    expect(d).toEqual({ dias: 28, visualizacoes: 18, cliquesNoSite: 4, ligacoes: 2, rotas: 0 });
  });

  it("converte as linhas do Search Console", () => {
    expect(linhasDeBusca({ rows: [{ keys: ["passeio lençóis maranhenses"], clicks: 12, impressions: 300, ctr: 0.04, position: 7.3 }] }))
      .toEqual([{ chave: "passeio lençóis maranhenses", cliques: 12, impressoes: 300, ctr: 0.04, posicao: 7.3 }]);
    expect(linhasDeBusca({})).toEqual([]);
  });

  it("explica quando a Business Profile API ainda não foi liberada", () => {
    expect(erroDoGoogleApis({ error: { code: 429, message: "Quota exceeded for quota metric 'Requests'", status: "RESOURCE_EXHAUSTED" } }))
      .toContain("pedir acesso");
    expect(erroDoGoogleApis({ error: { code: 403, message: "My Business API has not been used in project 1 before or it is disabled." } }))
      .toContain("não está ativada");
    expect(erroDoGoogleApis({ error: "invalid_grant" })).toContain("Autorize de novo");
    expect(erroDoGoogleApis({ accounts: [] })).toBeNull();
  });

  it("aponta só o que realmente falta no perfil", () => {
    const perfil = {
      conta: "accounts/1", local: "locations/2", titulo: "Guia Lençóis", endereco: "Barreirinhas, MA", site: null,
      telefone: "+55 98 0000-0000", categoria: "Agência de turismo", descricao: null, temHorario: true,
    };
    expect(lacunasDoPerfil(perfil)).toEqual(["descrição da empresa", "endereço do site"]);
  });
});
