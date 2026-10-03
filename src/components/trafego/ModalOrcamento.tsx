"use client";

/**
 * Editar orcamento diario. Mostra o valor atual, deixa fixar um valor ou
 * mexer em % / R$, e so envia depois que a pessoa ve o novo valor.
 */

import { useState } from "react";
import { brl } from "@/lib/trafego/metricas";

type Props = {
  nome: string;
  atual: number | null;
  salvando: boolean;
  onCancelar: () => void;
  onAplicar: (novoReais: number) => void;
};

export function ModalOrcamento({ nome, atual, salvando, onCancelar, onAplicar }: Props) {
  const [valor, setValor] = useState<number>(atual ?? 20);

  const ajustar = (fn: (v: number) => number) => setValor((v) => Math.max(1, Math.round(fn(v) * 100) / 100));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="font-serif text-lg text-zinc-100">Editar orcamento diario</h3>
        <p className="mt-1 truncate text-sm text-zinc-400">{nome}</p>

        <p className="mt-4 text-xs text-zinc-500">Orcamento atual</p>
        <p className="text-xl text-zinc-200 tabular-nums">{atual === null ? "nao informado" : brl(atual) + " / dia"}</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => ajustar((v) => v * 1.1)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-amber-400">Aumentar 10%</button>
          <button onClick={() => ajustar((v) => v * 0.9)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-amber-400">Diminuir 10%</button>
          <button onClick={() => ajustar((v) => v + 10)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-amber-400">Aumentar R$ 10</button>
          <button onClick={() => ajustar((v) => v - 10)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-amber-400">Diminuir R$ 10</button>
        </div>

        <label className="mt-4 block text-xs text-zinc-500" htmlFor="novo-orcamento">Novo valor por dia</label>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-zinc-400">R$</span>
          <input
            id="novo-orcamento"
            type="number"
            min={1}
            step="1"
            value={valor}
            onChange={(e) => setValor(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 tabular-nums"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancelar} className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">Cancelar</button>
          <button
            onClick={() => onAplicar(valor)}
            disabled={salvando || !(valor > 0)}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          >
            {salvando ? "Aplicando..." : "Aplicar na conta"}
          </button>
        </div>

        <p className="mt-3 text-xs text-zinc-500">
          Isso muda a campanha na conta de anuncios de verdade.
        </p>
      </div>
    </div>
  );
}
