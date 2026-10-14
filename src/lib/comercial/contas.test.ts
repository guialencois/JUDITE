import { describe, expect, it } from "vitest";
import { agruparVendas, progressoDasMetas, resumir, type Venda } from "./contas";

const venda = (m: Partial<Venda>): Venda => ({
  id: "1", data: "2026-10-02", produto: "Passeio Lagoa Azul", pessoas: 2, valor: 300, origem: "Instagram", campanha_id: null, observacao: null, ...m,
});

describe("página Comercial", () => {
  it("calcula faturamento, ticket médio, ROAS real e CAC", () => {
    const r = resumir([venda({}), venda({ id: "2", valor: 500, pessoas: 4 })], 200);
    expect(r).toEqual({ faturamento: 800, vendas: 2, pessoas: 6, ticketMedio: 400, roasReal: 4, cac: 100 });
  });

  it("sem gasto ou sem vendas, as contas ficam vazias em vez de inventar número", () => {
    expect(resumir([venda({})], 0)).toMatchObject({ roasReal: null, cac: null });
    expect(resumir([], 150)).toMatchObject({ faturamento: 0, vendas: 0, ticketMedio: null, roasReal: 0, cac: null });
  });

  it("agrupa por produto, do maior faturamento para o menor", () => {
    const g = agruparVendas(
      [venda({}), venda({ id: "2", produto: "Traslado", valor: 100 }), venda({ id: "3", valor: 600 })],
      (v) => v.produto,
    );
    expect(g.map((l) => l.rotulo)).toEqual(["Passeio Lagoa Azul", "Traslado"]);
    expect(g[0]).toMatchObject({ vendas: 2, faturamento: 900, ticketMedio: 450, parte: 0.9 });
  });

  it("mede o progresso das metas; em investimento e CAC o bom é ficar abaixo", () => {
    const r = resumir([venda({ valor: 1000 })], 400);
    const p = progressoDasMetas(
      [{ metrica: "faturamento", alvo: 2000 }, { metrica: "investimento", alvo: 500 }, { metrica: "cpa", alvo: 300 }],
      r, 400,
    );
    expect(p[0]).toMatchObject({ proporcao: 0.5, atingida: false });
    expect(p[1]).toMatchObject({ proporcao: 0.8, atingida: true });
    expect(p[2]).toMatchObject({ atual: 400, atingida: false });
  });
});
