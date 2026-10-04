import { afterEach, describe, expect, it, vi } from "vitest";
import { camposNovaCampanhaMeta } from "@/lib/anuncios/meta";
import { corpoNovaCampanhaTikTok } from "@/lib/anuncios/tiktok";
import { conferirRascunho, publicacaoReal, rascunhoSchema, type ContextoRascunho, type Rascunho } from "./rascunho";

const ID = "3f0e5a52-6c1b-4a0e-9b7a-2d6f6f0c1a11";
const rascunho = (m: Partial<Rascunho> = {}): Rascunho => ({
  plataforma: "facebook", nome: "JUDITE - Lagoa Azul", objetivo: "mensagens", orcamento_diario: 30,
  publico: { regiao: "Maranhão", idade_min: 25, idade_max: 55, interesses: "viagens" },
  produto_id: null, criativo_ids: [ID], justificativa: "Teste.", ...m,
});
const ctx = (m: Partial<ContextoRascunho> = {}): ContextoRascunho => ({
  maxSemAprovacao: 100,
  mes: { gastoNoMes: 200, outrasCampanhasPorDia: 20, diasRestantes: 10, mensalMax: 2000 },
  plataformasConectadas: ["meta"], criativosValidos: [ID], ...m,
});

describe("Campaign Manager: rascunho", () => {
  it("rascunho dentro dos limites passa sem avisos", () => {
    expect(conferirRascunho(rascunho(), ctx())).toEqual({ erro: null, avisos: [] });
  });

  it("recusa criativo de fora do workspace e idade invertida", () => {
    expect(conferirRascunho(rascunho(), ctx({ criativosValidos: [] })).erro).toContain("criativo");
    expect(conferirRascunho(rascunho({ publico: { regiao: "", idade_min: 60, idade_max: 30, interesses: "" } }), ctx()).erro).toContain("idade");
  });

  it("avisa quando passa do teto diário, do orçamento do mês ou falta conexão", () => {
    const r = conferirRascunho(rascunho({ orcamento_diario: 250 }), ctx({ plataformasConectadas: [] }));
    expect(r.erro).toBeNull();
    expect(r.avisos).toHaveLength(3);
    expect(r.avisos.join(" ")).toContain("orcamento mensal");
  });

  it("o schema não aceita orçamento zero, negativo ou acima do teto absoluto", () => {
    expect(rascunhoSchema.safeParse(rascunho({ orcamento_diario: 0 })).success).toBe(false);
    expect(rascunhoSchema.safeParse(rascunho({ orcamento_diario: 5001 })).success).toBe(false);
    expect(rascunhoSchema.safeParse(rascunho()).success).toBe(true);
  });
});

describe("Campaign Manager: segurança da publicação", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("o modo simulado é o padrão; real só com JUDITE_PUBLICACAO_REAL=1", () => {
    vi.stubEnv("JUDITE_PUBLICACAO_REAL", "");
    expect(publicacaoReal()).toBe(false);
    vi.stubEnv("JUDITE_PUBLICACAO_REAL", "true");
    expect(publicacaoReal()).toBe(false);
    vi.stubEnv("JUDITE_PUBLICACAO_REAL", "1");
    expect(publicacaoReal()).toBe(true);
  });

  it("a campanha é sempre criada PAUSADA, em todas as plataformas", () => {
    const nova = { conta: "act_1", nome: "JUDITE - Teste", objetivo: "trafego" as const, orcamentoDiarioReais: 30 };
    expect(camposNovaCampanhaMeta(nova)).toMatchObject({ status: "PAUSED", daily_budget: "3000", objective: "OUTCOME_TRAFFIC" });
    expect(corpoNovaCampanhaTikTok({ ...nova, conta: "700" })).toMatchObject({ operation_status: "DISABLE", budget: 30, budget_mode: "BUDGET_MODE_DAY" });
    expect(() => corpoNovaCampanhaTikTok({ ...nova, objetivo: "mensagens" })).toThrow();
  });
});
