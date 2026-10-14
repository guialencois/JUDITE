import { describe, expect, it } from "vitest";
import { ESTADOS, mudarEstado, podeTransitar, proximoEstadoMonitorado, type Estado, type Evento, type RepositorioDeEstados } from "./estados";

/** Repositório em memória: uma campanha só, com o mesmo "muda só se ainda estiver em de" do banco. */
function memoria(inicial: Estado) {
  const banco = { status: inicial as Estado, campos: {} as Record<string, unknown> };
  const eventos: Evento[] = [];
  const repo: RepositorioDeEstados = {
    async mudar(_ws, _id, de, para, campos) {
      if (banco.status !== de) return false;
      banco.status = para;
      Object.assign(banco.campos, campos);
      return true;
    },
    async registrar(e) { eventos.push(e); },
  };
  return { repo, banco, eventos };
}
const base = { workspaceId: "ws", rascunhoId: "r1", usuarioId: "dono", ator: "pessoa" as const };

describe("máquina de estados da campanha", () => {
  it("segue o caminho completo de uma campanha", () => {
    const caminho: Estado[] = ["rascunho", "aguardando_aprovacao", "publicada_pausada", "ativa", "aprendizado", "otimizando", "pausada_pela_ia", "ativa", "pausada", "concluida"];
    for (let i = 0; i < caminho.length - 1; i++) expect(podeTransitar(caminho[i], caminho[i + 1])).toBe(true);
  });

  it("não permite transições inválidas", () => {
    expect(podeTransitar("aguardando_aprovacao", "ativa")).toBe(false); // ativar sem criar
    expect(podeTransitar("rascunho", "ativa")).toBe(false);
    expect(podeTransitar("recusada", "aguardando_aprovacao")).toBe(false);
    expect(podeTransitar("recusada", "ativa")).toBe(false);
    expect(podeTransitar("publicada_pausada", "aprendizado")).toBe(false);
    for (const para of ESTADOS) expect(podeTransitar("concluida", para)).toBe(false);
  });

  it("aprovação: aguardando → criada e pausada, com histórico de quem aprovou", async () => {
    const { repo, banco, eventos } = memoria("aguardando_aprovacao");
    const r = await mudarEstado(repo, { ...base, de: "aguardando_aprovacao", para: "publicada_pausada", motivo: "Aprovada pelo dono.", campos: { decidido_por: "dono" } });
    expect(r).toEqual({ ok: true });
    expect(banco).toMatchObject({ status: "publicada_pausada", campos: { decidido_por: "dono" } });
    expect(eventos).toEqual([{ ...base, de: "aguardando_aprovacao", para: "publicada_pausada", motivo: "Aprovada pelo dono." }]);
  });

  it("recusa: aguardando → recusada, e depois disso nada mais muda", async () => {
    const { repo, banco, eventos } = memoria("aguardando_aprovacao");
    expect((await mudarEstado(repo, { ...base, de: "aguardando_aprovacao", para: "recusada", motivo: "Recusada." })).ok).toBe(true);
    const depois = await mudarEstado(repo, { ...base, de: "recusada", para: "publicada_pausada", motivo: "tentativa" });
    expect(depois.ok).toBe(false);
    expect(banco.status).toBe("recusada");
    expect(eventos).toHaveLength(1);
  });

  it("idempotência: o mesmo clique duas vezes muda uma vez só e não duplica o histórico", async () => {
    const { repo, eventos } = memoria("aguardando_aprovacao");
    const pedido = { ...base, de: "aguardando_aprovacao" as const, para: "publicada_pausada" as const, motivo: "Aprovada." };
    const [a, b] = [await mudarEstado(repo, pedido), await mudarEstado(repo, pedido)];
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false });
    expect(eventos).toHaveLength(1);
  });

  it("transição inválida não toca no banco nem no histórico", async () => {
    const { repo, banco, eventos } = memoria("aguardando_aprovacao");
    const r = await mudarEstado(repo, { ...base, de: "aguardando_aprovacao", para: "ativa", motivo: "pular etapas" });
    expect(r.ok).toBe(false);
    expect(banco.status).toBe("aguardando_aprovacao");
    expect(eventos).toHaveLength(0);
  });

  it("monitoramento: ativa → aprendizado → otimizando, e pausada pela JUDITE quando a autonomia pausou", () => {
    const viva = { ativaNaPlataforma: true, pausadaPelaAutomacao: false };
    expect(proximoEstadoMonitorado("ativa", { ...viva, diasComDados: 0 })).toBeNull();
    expect(proximoEstadoMonitorado("ativa", { ...viva, diasComDados: 2 })).toBe("aprendizado");
    expect(proximoEstadoMonitorado("aprendizado", { ...viva, diasComDados: 3 })).toBeNull();
    expect(proximoEstadoMonitorado("aprendizado", { ...viva, diasComDados: 7 })).toBe("otimizando");
    expect(proximoEstadoMonitorado("otimizando", { ...viva, diasComDados: 20 })).toBeNull();
    expect(proximoEstadoMonitorado("otimizando", { diasComDados: 20, ativaNaPlataforma: false, pausadaPelaAutomacao: true })).toBe("pausada_pela_ia");
    // Pausada na plataforma por uma pessoa (fora da JUDITE): o monitor não inventa quem pausou.
    expect(proximoEstadoMonitorado("ativa", { diasComDados: 5, ativaNaPlataforma: false, pausadaPelaAutomacao: false })).toBeNull();
    expect(proximoEstadoMonitorado("publicada_pausada", { ...viva, diasComDados: 9 })).toBeNull();
  });
});
