"use client";

/** Botao "Sincronizar dados": chama /api/trafego/sync e recarrega a tela. */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function BotaoSincronizar({ workspaceId, ultimaSync }: { workspaceId: string; ultimaSync: string | null }) {
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  async function sincronizar() {
    setErro(null);
    setRodando(true);
    try {
      const r = await fetch("/api/trafego/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, dias: 60 }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo?.erro ?? "Falha ao sincronizar.");
      // 207 = alguma plataforma falhou (ex.: sem conexão). Mostra o motivo em vez de fingir sucesso.
      const falhas = Array.isArray(corpo?.resumo)
        ? (corpo.resumo as { erro?: string }[]).map((x) => x.erro).filter((x): x is string => Boolean(x))
        : [];
      if (falhas.length) setErro(falhas.join(" "));
      iniciar(() => router.refresh());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-zinc-500">
        {ultimaSync ? "Atualizado " + minutosDesde(ultimaSync) : "Nunca sincronizado"}
      </span>
      <button
        onClick={sincronizar}
        disabled={rodando || pendente}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-amber-400 hover:text-amber-400 disabled:opacity-50"
      >
        {rodando || pendente ? "Sincronizando..." : "Sincronizar dados"}
      </button>
      {erro && <span className="text-xs text-rose-400">{erro}</span>}
    </div>
  );
}

function minutosDesde(iso: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutos < 1) return "agora";
  if (minutos < 60) return "ha " + minutos + " min";
  const horas = Math.round(minutos / 60);
  if (horas < 24) return "ha " + horas + "h";
  return "ha " + Math.round(horas / 24) + " dias";
}
