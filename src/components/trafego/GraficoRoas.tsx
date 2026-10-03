"use client";

/**
 * CPA x ROAS x vendas. Barras = vendas do dia, linhas = ROAS e CPA.
 * Dia sem base para a metrica nao vira zero: a linha corta ali.
 */

import { useState } from "react";
import { brl, dataCurta, multiplicador, type DiaAgregado } from "@/lib/trafego/metricas";

const L = 760, A = 260, MARGEM_ESQ = 44, MARGEM_DIR = 12, TOPO = 12, BASE = 34;

export function GraficoRoas({ dias }: { dias: DiaAgregado[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  if (!dias.length) return null;

  const largura = L - MARGEM_ESQ - MARGEM_DIR;
  const altura = A - TOPO - BASE;
  const x = (i: number) => MARGEM_ESQ + (largura * (i + 0.5)) / dias.length;

  const maxRoas = Math.max(...dias.map((d) => d.derivadas.roas ?? 0)) * 1.15 || 1;
  const maxCpa = Math.max(...dias.map((d) => d.derivadas.cpa ?? 0)) * 1.15 || 1;
  const maxVendas = Math.max(...dias.map((d) => d.totais.compras)) * 2.4 || 1;

  const linha = (pegar: (d: DiaAgregado) => number | null, maximo: number) => {
    let caminho = "";
    let levantado = true;
    dias.forEach((d, i) => {
      const v = pegar(d);
      if (v === null) { levantado = true; return; }
      const px = x(i).toFixed(1);
      const py = (TOPO + altura * (1 - v / maximo)).toFixed(1);
      caminho += (levantado ? "M" : "L") + px + "," + py;
      levantado = false;
    });
    return caminho;
  };

  const larguraBarra = Math.max(3, (largura / dias.length) * 0.5);
  const passo = Math.ceil(dias.length / 8);
  const temVendas = dias.some((d) => d.totais.compras > 0);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <h2 className="font-serif text-lg text-zinc-100">CPA x ROAS x vendas</h2>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />ROAS
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-400" />CPA
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/40" />Vendas
        </span>
      </div>

      <svg viewBox={`0 0 ${L} ${A}`} className="w-full" role="img" aria-label="ROAS, CPA e vendas por dia">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={MARGEM_ESQ} x2={L - MARGEM_DIR} y1={TOPO + altura * t} y2={TOPO + altura * t} className="stroke-zinc-800" />
            <text x="4" y={TOPO + altura * t + 4} className="fill-zinc-500" fontSize="10">
              {(maxRoas * (1 - t)).toFixed(1)}x
            </text>
          </g>
        ))}

        {dias.map((d, i) => (
          <rect
            key={d.data}
            x={x(i) - larguraBarra / 2}
            y={TOPO + altura - (altura * d.totais.compras) / maxVendas}
            width={larguraBarra}
            height={(altura * d.totais.compras) / maxVendas}
            rx="2"
            className="fill-amber-400/40"
          />
        ))}

        <path d={linha((d) => d.derivadas.cpa, maxCpa)} fill="none" className="stroke-rose-400" strokeWidth="2" />
        <path d={linha((d) => d.derivadas.roas, maxRoas)} fill="none" className="stroke-amber-400" strokeWidth="2.5" />

        {!temVendas && (
          <text x={MARGEM_ESQ + largura / 2} y={TOPO + altura / 2 - 10} textAnchor="middle" className="fill-zinc-500" fontSize="13">
            Nenhuma venda registrada no periodo
          </text>
        )}

        {dias.map((d, i) => (i % passo === 0 ? (
          <text key={d.data} x={x(i)} y={A - 8} textAnchor="middle" className="fill-zinc-500" fontSize="10">
            {dataCurta(d.data)}
          </text>
        ) : null))}

        {dias.map((d, i) => (
          <rect
            key={"alvo" + d.data}
            x={MARGEM_ESQ + (largura * i) / dias.length}
            y={TOPO}
            width={largura / dias.length}
            height={altura}
            fill="transparent"
            onMouseEnter={() => setAtivo(i)}
            onMouseLeave={() => setAtivo(null)}
          />
        ))}
      </svg>

      <p className="mt-2 h-5 text-xs text-zinc-400">
        {ativo !== null && (
          <>
            {dataCurta(dias[ativo].data)} · ROAS {multiplicador(dias[ativo].derivadas.roas)} · CPA{" "}
            {brl(dias[ativo].derivadas.cpa)} · {Math.round(dias[ativo].totais.compras)} vendas ·{" "}
            {brl(dias[ativo].totais.gasto)} de gasto
          </>
        )}
      </p>
    </div>
  );
}
