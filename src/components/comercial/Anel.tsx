/** Anel de progresso de uma meta do mês. proporcao = atual ÷ alvo (null quando ainda não há dado). */

type Props = {
  rotulo: string;
  atual: string;
  alvo: string;
  proporcao: number | null;
  /** true = bom, false = ruim, null = sem dado. */
  atingida: boolean | null;
  /** Em metas do tipo "teto" (investimento, CAC) o anel cheio significa que o limite foi alcançado. */
  teto?: boolean;
};

export function Anel({ rotulo, atual, alvo, proporcao, atingida, teto = false }: Props) {
  const raio = 34;
  const volta = 2 * Math.PI * raio;
  const cheio = proporcao === null ? 0 : Math.min(Math.max(proporcao, 0), 1);
  const cor = proporcao === null
    ? "stroke-zinc-700"
    : teto
      ? (atingida ? "stroke-amber-400" : "stroke-rose-400")
      : (atingida ? "stroke-emerald-400" : "stroke-amber-400");
  const pct = proporcao === null ? "-" : Math.round(proporcao * 100) + "%";

  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="relative h-20 w-20 shrink-0">
        <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" role="img" aria-label={`${rotulo}: ${pct} da meta`}>
          <circle cx="40" cy="40" r={raio} fill="none" className="stroke-zinc-800" strokeWidth="8" />
          <circle
            cx="40" cy="40" r={raio} fill="none" strokeWidth="8" strokeLinecap="round" className={cor}
            strokeDasharray={volta} strokeDashoffset={volta * (1 - cheio)}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-sm tabular-nums text-zinc-100">{pct}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-zinc-500">{rotulo}</p>
        <p className="truncate text-xl tabular-nums text-zinc-100">{atual}</p>
        <p className="text-xs text-zinc-500">{teto ? "limite" : "meta"}: {alvo}</p>
      </div>
    </div>
  );
}
