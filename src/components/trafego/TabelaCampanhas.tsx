"use client";

/**
 * Tabela do Gerenciador: metricas da campanha, chave de ligar/desligar e
 * edicao de orcamento. Toda acao passa por /api/trafego/acoes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { brl, inteiro, multiplicador, percent } from "@/lib/trafego/metricas";
import { ModalOrcamento } from "./ModalOrcamento";

export type LinhaCampanhaTabela = {
  plataforma: "google_ads" | "facebook";
  campanhaId: string;
  nome: string;
  status: string | null;
  orcamentoDiario: number | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  ctr: number | null;
  cpc: number | null;
  compras: number;
  cpa: number | null;
  receita: number;
  roas: number | null;
};

type Props = { workspaceId: string; podeAgir: boolean; linhas: LinhaCampanhaTabela[] };

export function TabelaCampanhas({ workspaceId, podeAgir, linhas }: Props) {
  const [editando, setEditando] = useState<LinhaCampanhaTabela | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const router = useRouter();

  async function chamar(corpo: Record<string, unknown>, chave: string): Promise<boolean> {
    setOcupado(chave);
    setAviso(null);
    try {
      const r = await fetch("/api/trafego/acoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, origem: "painel", tipoEntidade: "campanha", ...corpo }),
      });
      const dados = await r.json().catch(() => ({}));

      if (r.status === 409 && dados?.precisaAprovacao) {
        const segue = window.confirm(
          dados.motivo + "\n\nConfirma mesmo assim o valor de " + brl(Number(dados.valor)) + " por dia?",
        );
        if (!segue) return false;
        return chamar({ ...corpo, confirmado: true }, chave);
      }
      if (!r.ok) throw new Error(dados?.erro ?? "Nao consegui aplicar.");

      router.refresh();
      return true;
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setOcupado(null);
    }
  }

  const ativa = (s: string | null) => (s ?? "").toUpperCase() === "ENABLED" || (s ?? "").toUpperCase() === "ACTIVE";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      {aviso && <p className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{aviso}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-2 pr-2 font-medium">Ativa</th>
              <th className="py-2 pr-2 font-medium">Campanha</th>
              <th className="py-2 pr-2 font-medium">Invest.</th>
              <th className="py-2 pr-2 font-medium">Impr.</th>
              <th className="py-2 pr-2 font-medium">Cliq.</th>
              <th className="py-2 pr-2 font-medium">CTR</th>
              <th className="py-2 pr-2 font-medium">CPC</th>
              <th className="py-2 pr-2 font-medium">Compras</th>
              <th className="py-2 pr-2 font-medium">CPA</th>
              <th className="py-2 pr-2 font-medium">Receita</th>
              <th className="py-2 pr-2 font-medium">ROAS</th>
              <th className="py-2 font-medium">Orc./dia</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const chave = l.plataforma + l.campanhaId;
              return (
                <tr key={chave} className="border-t border-zinc-800">
                  <td className="py-2 pr-2">
                    <button
                      role="switch"
                      aria-checked={ativa(l.status)}
                      aria-label={(ativa(l.status) ? "Pausar" : "Ativar") + " " + l.nome}
                      disabled={!podeAgir || ocupado === chave}
                      onClick={() => {
                        const ligar = !ativa(l.status);
                        if (!window.confirm((ligar ? "Ativar" : "Pausar") + ' a campanha "' + l.nome + '" na conta de verdade?')) return;
                        chamar({ plataforma: l.plataforma, entidadeId: l.campanhaId, entidadeNome: l.nome, acao: ligar ? "ativar" : "pausar" }, chave);
                      }}
                      className={
                        "relative h-5 w-9 rounded-full transition " +
                        (ativa(l.status) ? "bg-emerald-500/80" : "bg-zinc-700") +
                        (ocupado === chave ? " opacity-50" : "")
                      }
                    >
                      <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all " + (ativa(l.status) ? "left-4" : "left-0.5")} />
                    </button>
                  </td>
                  <td className="max-w-[260px] truncate py-2 pr-2 text-zinc-200">{l.nome}</td>
                  <td className="py-2 pr-2 tabular-nums text-zinc-300">{brl(l.gasto)}</td>
                  <td className="py-2 pr-2 tabular-nums text-zinc-400">{inteiro(l.impressoes)}</td>
                  <td className="py-2 pr-2 tabular-nums text-zinc-400">{inteiro(l.cliques)}</td>
                  <td className="py-2 pr-2 tabular-nums text-zinc-400">{percent(l.ctr)}</td>
                  <td className="py-2 pr-2 tabular-nums text-zinc-400">{brl(l.cpc)}</td>
                  <td className="py-2 pr-2 tabular-nums text-zinc-300">{inteiro(l.compras)}</td>
                  <td className="py-2 pr-2 tabular-nums text-zinc-300">{brl(l.cpa)}</td>
                  <td className="py-2 pr-2 tabular-nums text-zinc-300">{brl(l.receita)}</td>
                  <td className="py-2 pr-2 tabular-nums text-amber-400">{multiplicador(l.roas)}</td>
                  <td className="py-2">
                    <button
                      onClick={() => setEditando(l)}
                      disabled={!podeAgir}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-amber-400 hover:text-amber-400"
                    >
                      {l.orcamentoDiario === null ? "definir" : brl(l.orcamentoDiario)}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!linhas.length && (
              <tr><td colSpan={12} className="py-6 text-center text-sm text-zinc-500">Nenhuma campanha sincronizada ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <ModalOrcamento
          nome={editando.nome}
          atual={editando.orcamentoDiario}
          salvando={ocupado === editando.plataforma + editando.campanhaId}
          onCancelar={() => setEditando(null)}
          onAplicar={async (novo) => {
            const ok = await chamar(
              { plataforma: editando.plataforma, entidadeId: editando.campanhaId, entidadeNome: editando.nome, acao: "definir_orcamento", valorReais: novo },
              editando.plataforma + editando.campanhaId,
            );
            if (ok) setEditando(null);
          }}
        />
      )}
    </div>
  );
}
