/** Aviso das telas de tráfego: quais plataformas ainda não estão conectadas neste workspace. */

import Link from "next/link";

export type ConexaoFaltando = { nome: string; apelido: string };

export function AvisoConexoes({ workspaceId, faltando, total }: { workspaceId: string; faltando: ConexaoFaltando[]; total: number }) {
  if (!faltando.length) return null;
  const nenhuma = faltando.length === total;
  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <p className="font-medium">
        {nenhuma ? "Nenhuma plataforma de anúncios conectada ainda." : "Ainda há plataformas sem conexão."}
      </p>
      <ul className="mt-1 list-disc pl-5 text-amber-100/90">
        {faltando.map((f) => (
          <li key={f.nome}>{f.nome}: conecte {f.apelido} em Conexões para os dados aparecerem aqui.</li>
        ))}
      </ul>
      <Link href={`/painel/${workspaceId}/conexoes`} className="mt-2 inline-block text-amber-300 underline">
        Abrir Conexões
      </Link>
    </div>
  );
}
