/**
 * Cartao de KPI com o anel de variacao contra o periodo anterior.
 * As classes Tailwind aqui sao um ponto de partida: troque pelas do design
 * system da JUDITE.
 */

type Props = {
  rotulo: string;
  valor: string;
  variacao: number | null;
  /** true quando subir e ruim (CPA, custo) */
  inverso?: boolean;
  /** true quando a variacao nao deve ganhar cor (gasto) */
  neutro?: boolean;
};

export function CartaoKpi({ rotulo, valor, variacao, inverso = false, neutro = false }: Props) {
  const tem = variacao !== null && Number.isFinite(variacao);
  const bom = tem ? (inverso ? (variacao as number) <= 0 : (variacao as number) >= 0) : true;
  const cor = !tem || neutro ? "text-zinc-400" : bom ? "text-emerald-400" : "text-rose-400";
  const traco = !tem || neutro ? "stroke-zinc-700" : bom ? "stroke-emerald-400" : "stroke-rose-400";

  const proporcao = tem ? Math.min(Math.abs(variacao as number), 1) : 0;
  const raio = 16;
  const volta = 2 * Math.PI * raio;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-zinc-400">{rotulo}</p>
          <p className="mt-1 truncate font-serif text-2xl text-zinc-100 tabular-nums">{valor}</p>
        </div>
        <svg viewBox="0 0 40 40" className="h-10 w-10 shrink-0 -rotate-90" aria-hidden="true">
          <circle cx="20" cy="20" r={raio} fill="none" className="stroke-zinc-800" strokeWidth="4" />
          <circle
            cx="20" cy="20" r={raio} fill="none" strokeWidth="4" strokeLinecap="round"
            className={traco}
            strokeDasharray={volta}
            strokeDashoffset={volta * (1 - proporcao)}
          />
        </svg>
      </div>
      <p className={"mt-2 text-xs " + cor}>
        {tem
          ? ((variacao as number) >= 0 ? "+" : "-") +
            (Math.abs(variacao as number) * 100).toFixed(1).replace(".", ",") +
            "% vs. periodo anterior"
          : "sem base de comparacao"}
      </p>
    </div>
  );
}
