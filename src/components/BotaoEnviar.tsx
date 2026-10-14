"use client";

/** Botão de formulário que mostra "aguarde" enquanto a ação do servidor roda (evita clique duplo). */

import { useFormStatus } from "react-dom";

export function BotaoEnviar({ children, aguarde, className }: { children: React.ReactNode; aguarde: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={(className ?? "") + " disabled:opacity-50"}>
      {pending ? aguarde : children}
    </button>
  );
}
