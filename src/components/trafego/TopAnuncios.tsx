"use client";

/** Top 10 anuncios: barras por ROAS e a tabela com os numeros. */

import { useState } from "react";
import { brl, multiplicador, type ItemRanking } from "@/lib/trafego/metricas";
import { NOME_PLATAFORMA } from "@/lib/trafego/tipos";

type Ordem = "receita" | "roas" | "cpa";

export function TopAnuncios({ itens }: { itens: ItemRanking[] }) {
  const [ordem, setOrdem] = useState<Ordem>("receita");

  const ordenados = [...itens].sort((a, b) => {
    if (ordem === "cpa") return (a.derivadas.cpa ?? Infinity) - (b.derivadas.cpa ?? Infinity);
    if (ordem === "roas") return (b.derivadas.roas ?? -1) - (a.derivadas.roas ?? -1);
    return b.totais.receita - a.totais.receita;
  }).slice(0, 10);

  const maiorRoas = Math.max(0.0001, ...ordenados.map((i) => i.derivadas.roas ?? 0));

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 font-serif text-lg text-zinc-100">Top 10 anuncios</h2>
        <span className="text-xs text-zinc-500">Ordenar por</span>
        {(["receita", "roas", "cpa"] as Ordem[]).map((o) => (
          <button
            key={o}
            onClick={() => setOrdem(o)}
            className={
              "rounded-lg border px-2.5 py-1 text-xs capitalize " +
              (ordem === o ? "border-amber-400 text-amber-400" : "border-zinc-700 text-zinc-400 hover:text-zinc-200")
            }
          >
            {o}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Anuncio</th>
              <th className="py-2 pr-2 font-medium">Plataforma</th>
              <th className="py-2 pr-2 font-medium">Gasto</th>
              <th className="py-2 pr-2 font-medium">Receita</th>
              <th className="py-2 pr-2 font-medium">ROAS</th>
              <th className="py-2 font-medium">CPA</th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((item, i) => (
              <tr key={item.chave} className="border-t border-zinc-800">
                <td className="py-2 pr-2 text-zinc-500">{i + 1}</td>
                <td className="py-2 pr-2 text-zinc-200">{item.nome}</td>
                <td className="py-2 pr-2">
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
                    {NOME_PLATAFORMA[item.plataforma as "google_ads" | "facebook"] ?? item.plataforma}
                  </span>
                </td>
                <td className="py-2 pr-2 tabular-nums text-zinc-300">{brl(item.totais.gasto)}</td>
                <td className="py-2 pr-2 tabular-nums text-zinc-300">{brl(item.totais.receita)}</td>
                <td className="py-2 pr-2">
                  <div className="relative h-5 w-28 overflow-hidden rounded bg-zinc-800">
                    <div
                      className="absolute inset-y-0 left-0 bg-amber-400/50"
                      style={{ width: ((item.derivadas.roas ?? 0) / maiorRoas) * 100 + "%" }}
                    />
                    <span className="relative pl-2 text-xs leading-5 text-zinc-200">
                      {multiplicador(item.derivadas.roas)}
                    </span>
                  </div>
                </td>
                <td className="py-2 tabular-nums text-zinc-300">{brl(item.derivadas.cpa)}</td>
              </tr>
            ))}
            {!ordenados.length && (
              <tr><td colSpan={7} className="py-6 text-center text-sm text-zinc-500">Sem dados no periodo.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
