import { describe, expect, it } from "vitest";
import { DIAS_APOS_RECUSA, escolherProduto, MAX_PROPOSTAS_PENDENTES, type RascunhoSimples } from "./propor";

const AGORA = new Date("2026-10-05T12:00:00Z");
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 864e5).toISOString();
const produtos = [{ id: "a", nome: "Atins" }, { id: "b", nome: "Lagoa Azul" }, { id: "c", nome: "Lagoa Bonita" }];
const r = (produto_id: string | null, status: string, dias = 1, origem = "diretor"): RascunhoSimples =>
  ({ produto_id, status, origem, criado_em: diasAtras(dias) });

describe("proposta automática de campanha: escolha do produto", () => {
  it("sem produto cadastrado, não propõe e explica", () => {
    const e = escolherProduto([], [], AGORA);
    expect(e.produto).toBeNull();
    expect(e.motivo).toContain("Cadastre");
  });

  it("sem histórico, escolhe o primeiro produto por nome", () => {
    expect(escolherProduto(produtos, [], AGORA).produto?.id).toBe("a");
  });

  it("pula produto com campanha aguardando, criada pausada ou ativa", () => {
    expect(escolherProduto(produtos, [r("a", "aguardando_aprovacao")], AGORA).produto?.id).toBe("b");
    expect(escolherProduto(produtos, [r("a", "publicada_pausada"), r("b", "ativa")], AGORA).produto?.id).toBe("c");
  });

  it("não insiste em produto recusado há pouco, mas volta depois do prazo", () => {
    expect(escolherProduto(produtos, [r("a", "recusada", DIAS_APOS_RECUSA - 1)], AGORA).produto?.id).toBe("b");
    const antigos = [r("a", "recusada", DIAS_APOS_RECUSA + 1), r("b", "erro", 3), r("c", "erro", 2)];
    expect(escolherProduto(produtos, antigos, AGORA).produto?.id).toBe("a");
  });

  it("prefere o produto que nunca recebeu proposta", () => {
    expect(escolherProduto(produtos, [r("a", "erro", 30), r("b", "erro", 40)], AGORA).produto?.id).toBe("c");
  });

  it("para de propor quando já há propostas da JUDITE esperando avaliação", () => {
    const pendentes = Array.from({ length: MAX_PROPOSTAS_PENDENTES }, (_, i) => r(i === 0 ? "a" : "b", "aguardando_aprovacao"));
    const e = escolherProduto(produtos, pendentes, AGORA);
    expect(e.produto).toBeNull();
    expect(e.motivo).toContain("aguardando a sua avaliação");
  });

  it("rascunho montado à mão não conta no limite de propostas da JUDITE", () => {
    const manuais = [r(null, "aguardando_aprovacao", 1, "painel"), r(null, "aguardando_aprovacao", 1, "painel")];
    expect(escolherProduto(produtos, manuais, AGORA).produto?.id).toBe("a");
  });

  it("quando todos os produtos estão ocupados, não propõe", () => {
    const todos = [r("a", "ativa"), r("b", "publicada_pausada"), r("c", "recusada", 2)];
    const e = escolherProduto(produtos, todos, AGORA);
    expect(e.produto).toBeNull();
    expect(e.motivo).toContain("Nada novo");
  });
});
