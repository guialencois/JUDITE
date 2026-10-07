import { describe, expect, it } from "vitest";
import { conferirVariacoes, fonteDoProduto, numerosNaoCadastrados, type ProdutoParaTexto, type Variacao } from "./gerar";

const produto: ProdutoParaTexto = {
  nome: "Passeio Lagoa Azul", descricao: "Passeio de 4x4 pelos Lençóis Maranhenses.", preco: 150,
  detalhes: "Duração de 4 horas. Saída às 14h de Barreirinhas.", publico: "Famílias e casais", link: null,
};
const variacao = (m: Partial<Variacao> = {}): Variacao => ({
  formato: "AIDA", titulo: "Conheça a Lagoa Azul", descricao: "Passeio de 4x4 saindo de Barreirinhas.", cta: "Reserve agora",
  texto: "Imagine nadar numa lagoa no meio das dunas. O passeio dura 4 horas e sai às 14h. Reserve pelo WhatsApp.", ...m,
});

describe("Creative Studio: nada de dado inventado", () => {
  it("aceita números que estão no cadastro, em qualquer formato de escrita", () => {
    const fonte = fonteDoProduto(produto);
    expect(numerosNaoCadastrados("Por R$ 150,00, 4 horas de passeio em 4x4, saída 14h", fonte)).toEqual([]);
    expect(numerosNaoCadastrados("Por apenas R$ 150", fonte)).toEqual([]);
  });

  it("aponta preço, desconto, nota ou duração que não estão no cadastro", () => {
    const fonte = fonteDoProduto(produto);
    expect(numerosNaoCadastrados("De R$ 200 por R$ 150", fonte)).toEqual(["200"]);
    expect(numerosNaoCadastrados("10% de desconto, nota 4,9 com 300 avaliações", fonte)).toEqual(["10", "4,9", "300"]);
  });

  it("produto sem preço cadastrado não pode ter preço no anúncio", () => {
    const semPreco = { ...produto, preco: null };
    const r = conferirVariacoes([variacao({ descricao: "A partir de R$ 150." })], semPreco, "facebook");
    expect(r.aceitas).toHaveLength(0);
    expect(r.descartadas[0].motivo).toContain("não está no cadastro");
  });

  it("descarta variação maior que o limite da plataforma e mantém as boas", () => {
    const r = conferirVariacoes(
      [variacao(), variacao({ titulo: "Um título comprido demais para um anúncio de busca do Google" }), variacao({ texto: " " })],
      produto, "google_ads",
    );
    expect(r.aceitas).toHaveLength(1);
    expect(r.descartadas.map((d) => d.motivo)).toEqual(["passou do tamanho permitido pela plataforma", "veio incompleta"]);
  });
});
