/**
 * A "porta" entre a JUDITE e as plataformas de anúncio.
 *
 * As telas e as rotas só conhecem esta interface. Cada plataforma tem o seu provedor
 * nativo (API oficial, sem intermediário pago), escolhido por workspace conforme a
 * conexão salva na página Conexões. Quando o LUNIKO assumir a execução, basta criar
 * outro provedor com os mesmos métodos: telas, freios de orçamento e histórico continuam iguais.
 *
 * Roda SOMENTE no servidor.
 */

import { lerConexao } from "@/lib/conexoes/segredos";
import { CONEXAO_DA_PLATAFORMA } from "@/lib/conexoes/status";
import type { createAdminClient } from "@/lib/supabase/admin";
import { NOME_PLATAFORMA, type AcaoAnuncio, type LinhaCampanha, type LinhaMetrica, type Plataforma } from "@/lib/trafego/tipos";
import { provedorMeta } from "./meta";

type Admin = ReturnType<typeof createAdminClient>;

export type Periodo = { plataforma: Plataforma; contas: string[]; de: string; ate: string };

export interface ProvedorAnuncios {
  nome: string;
  /** Como a plataforma chama uma campanha ligada e uma pausada (para gravar o estado depois de uma ação). */
  statusAtiva: string;
  statusPausada: string;
  /** Métricas diárias por campanha/anúncio no período. */
  lerMetricas(p: Periodo): Promise<LinhaMetrica[]>;
  /** Estado atual das campanhas (status e orçamento diário). */
  lerCampanhas(p: Periodo): Promise<LinhaCampanha[]>;
  /** Aplica uma mudança de verdade na conta. Chamar só depois dos freios de limites.ts. */
  executar(acao: AcaoAnuncio): Promise<unknown>;
}

export type Resolucao = { ok: true; provedor: ProvedorAnuncios } | { ok: false; motivo: string };

/**
 * Monta o provedor da plataforma com as credenciais do workspace.
 * Sem conexão pronta devolve um motivo em português, para a tela e o histórico mostrarem.
 * Chamar só depois de conferir quem está pedindo (os segredos saem abertos daqui).
 */
export async function provedorDoWorkspace(db: Admin, workspaceId: string, plataforma: Plataforma): Promise<Resolucao> {
  const nome = NOME_PLATAFORMA[plataforma];
  let conexao: Awaited<ReturnType<typeof lerConexao>>;
  try {
    conexao = await lerConexao(db, workspaceId, CONEXAO_DA_PLATAFORMA[plataforma]);
  } catch {
    return { ok: false, motivo: `Não foi possível abrir a conexão de ${nome}. Refaça a conexão na página Conexões.` };
  }
  const { segredos, dados } = conexao;

  if (plataforma === "facebook") {
    if (!segredos.token || !dados.conta) return { ok: false, motivo: "Conecte a Meta em Conexões para ler e mudar as campanhas." };
    return { ok: true, provedor: provedorMeta({ token: segredos.token, moeda: typeof dados.moeda === "string" ? dados.moeda : null }) };
  }

  return { ok: false, motivo: `A leitura nativa de ${nome} ainda não está disponível.` };
}
