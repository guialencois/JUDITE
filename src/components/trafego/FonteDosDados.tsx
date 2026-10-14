/** Linha das telas de tráfego: de onde vêm os dados (e as ações) de cada plataforma neste workspace. */

import Link from "next/link";
import { NOME_PLATAFORMA, PLATAFORMAS, type Plataforma } from "@/lib/trafego/tipos";
import { NOME_FONTE, type Fonte } from "@/lib/windsor/conexao";

export function FonteDosDados({ workspaceId, fontes }: { workspaceId: string; fontes: Record<Plataforma, Fonte> }) {
  return (
    <p className="mb-4 text-xs text-zinc-500">
      Fonte dos dados e das ações:{" "}
      {PLATAFORMAS.map((p, i) => (
        <span key={p}>
          {i > 0 && " · "}
          {NOME_PLATAFORMA[p]} pela <span className={fontes[p] === "windsor" ? "text-sky-300" : "text-zinc-300"}>{NOME_FONTE[fontes[p]]}</span>
        </span>
      ))}
      . <Link href={`/painel/${workspaceId}/conexoes`} className="underline">Trocar em Conexões</Link>
    </p>
  );
}
