import { describe, expect, it } from "vitest";
import { validarOrcamento } from "@/lib/trafego/limites";
import { decidirAutonomia, MAX_ACOES_POR_RODADA, type ContextoAutonomia } from "./autonomia";
import type { CampanhaResumo } from "./tipos";

const campanha = (m: Partial<CampanhaResumo> = {}): CampanhaResumo => ({
  plataforma: "facebook", campanha_id: "c1", nome: "Campanha", status: "ACTIVE", ativa: true, orcamento_diario: 50,
  gasto: 300, impressoes: 20000, cliques: 300, compras: 10, receita: 0, dias_com_dados: 14, ctr: 0.015, cpc: 1, ...m,
});
const ctx = (m: Partial<ContextoAutonomia> = {}): ContextoAutonomia => ({ aumentoMaxPercent: 10, mexidasRecentemente: new Set(), ...m });

/** Uma campanha "normal" que converte: serve de referência (CPA médio) para as outras. */
const referencia = campanha({ campanha_id: "ref", nome: "Referência", gasto: 300, compras: 10 });

describe("autonomia supervisionada: regras", () => {
  it("pausa campanha com gasto alto e zero conversões, depois do volume mínimo", () => {
    const d = decidirAutonomia([referencia, campanha({ campanha_id: "ruim", nome: "Ruim", gasto: 250, compras: 0 })], ctx());
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ acao: "pausar", campanha_id: "ruim" });
    expect(d[0].motivo).toContain("nenhuma conversão");
  });

  it("não pausa sem volume mínimo, sem período de aprendizado ou com gasto baixo", () => {
    const ruim = { campanha_id: "ruim", compras: 0, gasto: 250 };
    expect(decidirAutonomia([referencia, campanha({ ...ruim, cliques: 60 })], ctx())).toEqual([]);
    expect(decidirAutonomia([referencia, campanha({ ...ruim, dias_com_dados: 4 })], ctx())).toEqual([]);
    expect(decidirAutonomia([referencia, campanha({ ...ruim, gasto: 40 })], ctx())).toEqual([]);
    expect(decidirAutonomia([referencia, campanha({ ...ruim, ativa: false })], ctx())).toEqual([]);
  });

  it("não pausa quando a plataforma não mede conversões (pode ser só falta de rastreamento)", () => {
    const d = decidirAutonomia([campanha({ compras: 0, gasto: 500 }), campanha({ campanha_id: "c2", compras: 0, gasto: 400 })], ctx());
    expect(d).toEqual([]);
  });

  it("reduz 10% a verba de campanha com custo por conversão 2x acima da média", () => {
    // média = (300 + 400) / (10 + 2) = 58,33 ; cara: 400 / 2 = 200
    const d = decidirAutonomia([referencia, campanha({ campanha_id: "cara", gasto: 400, compras: 2, orcamento_diario: 60 })], ctx());
    expect(d[0]).toMatchObject({ acao: "definir_orcamento", campanha_id: "cara", valorReais: 54 });
    // A referência (30 por conversão, bem abaixo da média) ganha o aumento de 10%, depois da redução.
    expect(d[1]).toMatchObject({ acao: "definir_orcamento", campanha_id: "ref", valorReais: 55 });
    expect(d).toHaveLength(2);
  });

  it("aumenta no máximo 10% a verba de campanha boa, e só com conversões mínimas", () => {
    // média = (600 + 100) / (8 + 10) = 38,89 ; fraca: 75 (não chega a 2x) ; boa: 100 / 10 = 10
    const fraca = campanha({ campanha_id: "fraca", gasto: 600, compras: 8 });
    const boa = campanha({ campanha_id: "boa", gasto: 100, compras: 10, orcamento_diario: 40 });
    const d = decidirAutonomia([fraca, boa], ctx());
    expect(d).toEqual([expect.objectContaining({ acao: "definir_orcamento", campanha_id: "boa", valorReais: 44 })]);
    // Com poucas conversões não aumenta.
    expect(decidirAutonomia([fraca, { ...boa, compras: 3, gasto: 30 }], ctx())).toEqual([]);
  });

  it("respeita o limite do workspace quando ele é menor que 10%", () => {
    const fraca = campanha({ campanha_id: "fraca", gasto: 600, compras: 8 });
    const boa = campanha({ campanha_id: "boa", gasto: 100, compras: 10, orcamento_diario: 40 });
    expect(decidirAutonomia([fraca, boa], ctx({ aumentoMaxPercent: 5 }))[0].valorReais).toBe(42);
  });

  it("o aumento automático sempre cabe no freio de % por ajuste", () => {
    const fraca = campanha({ campanha_id: "fraca", gasto: 600, compras: 8 });
    for (const orcamento of [7.77, 33.33, 40, 99.99]) {
      const [d] = decidirAutonomia([fraca, campanha({ campanha_id: "boa", gasto: 100, compras: 10, orcamento_diario: orcamento })], ctx());
      const freio = validarOrcamento({ atualReais: orcamento, novoReais: d.valorReais as number, maxSemAprovacao: 1000, aumentoMaxPercent: 10 });
      expect(freio).toMatchObject({ ok: true, precisaAprovacao: false });
    }
  });

  it("aumento que passa do teto diário ou do mês não é aplicado: os freios mandam para aprovação", () => {
    // A autonomia propõe 104,50; o teto sem aprovação é 100 -> aguardando aprovação.
    const acimaDoTeto = validarOrcamento({ atualReais: 95, novoReais: 104.5, maxSemAprovacao: 100, aumentoMaxPercent: 10 });
    expect(acimaDoTeto.precisaAprovacao).toBe(true);
    const estouraMes = validarOrcamento({
      atualReais: 40, novoReais: 44, maxSemAprovacao: 100, aumentoMaxPercent: 10,
      mes: { gastoNoMes: 1900, outrasCampanhasPorDia: 0, diasRestantes: 10, mensalMax: 2000 },
    });
    expect(estouraMes.precisaAprovacao).toBe(true);
  });

  it("não mexe de novo em campanha que teve ação nos últimos dias", () => {
    const ruim = campanha({ campanha_id: "ruim", gasto: 250, compras: 0 });
    expect(decidirAutonomia([referencia, ruim], ctx({ mexidasRecentemente: new Set(["facebook|ruim"]) }))).toEqual([]);
  });

  it("não reduz abaixo do orçamento mínimo nem age sem saber o orçamento atual", () => {
    const cara = { campanha_id: "cara", gasto: 400, compras: 2 };
    const daCara = (orcamento_diario: number | null) =>
      decidirAutonomia([referencia, campanha({ ...cara, orcamento_diario })], ctx()).filter((d) => d.campanha_id === "cara");
    expect(daCara(5)).toEqual([]);
    expect(daCara(null)).toEqual([]);
    expect(daCara(60)).toHaveLength(1);
  });

  it("limita o número de ações por dia e prioriza pausar", () => {
    const ruins = Array.from({ length: 5 }, (_, i) => campanha({ campanha_id: `ruim${i}`, gasto: 250, compras: 0 }));
    const cara = campanha({ campanha_id: "cara", gasto: 2000, compras: 2, orcamento_diario: 60 });
    const d = decidirAutonomia([referencia, cara, ...ruins], ctx());
    expect(d).toHaveLength(MAX_ACOES_POR_RODADA);
    expect(d.every((x) => x.acao === "pausar")).toBe(true);
  });

  it("compara cada campanha só com a média da própria plataforma", () => {
    const google = campanha({ plataforma: "google_ads", campanha_id: "g1", gasto: 250, compras: 0 });
    // A Meta converte, o Google não mede conversão: a campanha do Google não é pausada.
    expect(decidirAutonomia([referencia, google], ctx())).toEqual([]);
  });
});
