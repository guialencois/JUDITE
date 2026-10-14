import { describe, expect, it } from "vitest";
import { agrupar, canal, ehTeste, haQuanto, totais, type EventoSite } from "./resumo";

const evento = (mudancas: Partial<EventoSite>): EventoSite => ({
  ocorrido_em: "2026-10-04T12:00:00.000Z",
  tipo: "pageview",
  nome: null,
  caminho: "/",
  origem: null,
  utm_source: null,
  utm_campaign: null,
  anuncio: null,
  dispositivo: "celular",
  cidade: null,
  regiao: null,
  visitante: "a".repeat(24),
  ...mudancas,
});

describe("aba Site", () => {
  it("reconhece o evento do modo de teste", () => {
    expect(ehTeste({ tipo: "evento", nome: "judite_teste" })).toBe(true);
    expect(ehTeste({ tipo: "evento", nome: "instagram_click" })).toBe(false);
    expect(ehTeste({ tipo: "pageview", nome: "judite_teste" })).toBe(false);
  });

  it("conta visitantes únicos por dia e a conversão em WhatsApp", () => {
    const t = totais([
      evento({}),
      evento({ caminho: "/atins.html" }),
      evento({ visitante: "b".repeat(24) }),
      evento({ tipo: "whatsapp" }),
    ]);
    expect(t.visitantes).toBe(2);
    expect(t.visualizacoes).toBe(3);
    expect(t.whatsapp).toBe(1);
    expect(t.conversao).toBe(0.5);
  });

  it("sem visitas a conversão fica vazia, não zero", () => {
    expect(totais([]).conversao).toBeNull();
  });

  it("atribui o clique no WhatsApp à origem da primeira visita do dia", () => {
    const linhas = agrupar(
      [evento({ anuncio: "meta" }), evento({ tipo: "whatsapp" })],
      canal,
    );
    expect(linhas).toEqual([{ rotulo: "Anúncio Meta", visitantes: 1, visualizacoes: 1, whatsapp: 1, carrinho: 0 }]);
  });

  it("descreve há quanto tempo chegou a última visita", () => {
    const agora = Date.parse("2026-10-04T12:00:00.000Z");
    expect(haQuanto("2026-10-04T12:00:00.000Z", agora)).toBe("agora mesmo");
    expect(haQuanto("2026-10-04T11:55:00.000Z", agora)).toBe("há 5 min");
    expect(haQuanto("2026-10-04T09:00:00.000Z", agora)).toBe("há 3 h");
    expect(haQuanto("2026-10-03T12:00:00.000Z", agora)).toBe("há 1 dia");
  });
});
