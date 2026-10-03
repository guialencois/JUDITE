/** Funil de aquisicao desenhado em blocos, com a conversao de uma etapa para a outra. */

import { inteiro, percent } from "@/lib/trafego/metricas";
import type { EtapaFunil } from "@/lib/trafego/metricas";

export function Funil({ etapas }: { etapas: EtapaFunil[] }) {
  const maior = Math.max(1, ...etapas.map((e) => e.valor ?? 0));

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-4 font-serif text-lg text-zinc-100">Funil de aquisicao</h2>
      <ul className="space-y-3">
        {etapas.map((e, i) => {
          const medida = e.valor !== null;
          const largura = medida ? Math.max(8, ((e.valor as number) / maior) * 100) : 100 - i * 14;
          return (
            <li key={e.etapa}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-zinc-300">{e.etapa}</span>
                <span className="tabular-nums text-zinc-100">
                  {inteiro(e.valor)}
                  {e.conversao !== null && (
                    <span className="ml-2 text-xs text-zinc-500">{percent(e.conversao)}</span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={"h-full rounded-full bg-amber-400 " + (medida ? "" : "opacity-20")}
                  style={{ width: largura + "%" }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-zinc-500">
        Etapa com &quot;-&quot; e metrica que a fonte nao informa. O Google Ads, por exemplo,
        nao entrega page view nem carrinho.
      </p>
    </div>
  );
}
