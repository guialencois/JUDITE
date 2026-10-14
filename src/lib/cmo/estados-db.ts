/**
 * Repositório de estados no Supabase (service role). SOMENTE no servidor, depois de conferir quem pediu.
 * Também avisa o LUNIKO de cada mudança, quando a ponte estiver configurada (src/lib/luniko/eventos.ts).
 */

import { emitirEvento } from "@/lib/luniko/eventos";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Evento, RepositorioDeEstados } from "./estados";

type Admin = ReturnType<typeof createAdminClient>;

/** Grava o evento no histórico. Antes da migração a tabela não existe: o erro é ignorado de propósito (o fluxo antigo continua). */
export async function registrarEvento(db: Admin, e: Evento): Promise<void> {
  await db.from("campanha_eventos").insert({
    workspace_id: e.workspaceId, rascunho_id: e.rascunhoId, de: e.de, para: e.para, ator: e.ator,
    usuario_id: e.usuarioId, motivo: e.motivo.slice(0, 500),
  });
  await emitirEvento("campanha.estado_mudou", {
    workspace_id: e.workspaceId, campanha_id: e.rascunhoId, de: e.de, para: e.para, ator: e.ator, motivo: e.motivo.slice(0, 500),
  });
}

export function repositorioDeEstados(db: Admin): RepositorioDeEstados {
  return {
    async mudar(workspaceId, rascunhoId, de, para, campos) {
      const { data, error } = await db.from("campanha_rascunhos").update({ ...campos, status: para })
        .eq("id", rascunhoId).eq("workspace_id", workspaceId).eq("status", de).select("id");
      return !error && (data?.length ?? 0) > 0;
    },
    registrar: (evento) => registrarEvento(db, evento),
  };
}
