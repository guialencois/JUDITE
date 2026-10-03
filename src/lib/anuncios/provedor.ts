/**
 * A "porta" entre a JUDITE e as plataformas de anúncio.
 *
 * As telas e as rotas só conhecem esta interface. Hoje quem a implementa é o
 * Windsor (temporário). Quando o LUNIKO assumir a execução, basta criar outro
 * provedor com os mesmos métodos e trocar em provedorAtual(): telas, freios de
 * orçamento e histórico continuam iguais.
 *
 * Roda SOMENTE no servidor.
 */

import type { AcaoAnuncio, LinhaCampanha, LinhaMetrica, Plataforma } from "@/lib/trafego/tipos";
import { provedorWindsor } from "./windsor";

export type Periodo = { plataforma: Plataforma; contas: string[]; de: string; ate: string };

export interface ProvedorAnuncios {
  nome: string;
  /** Métricas diárias por campanha/anúncio no período. */
  lerMetricas(p: Periodo): Promise<LinhaMetrica[]>;
  /** Estado atual das campanhas (status e orçamento diário). */
  lerCampanhas(p: Periodo): Promise<LinhaCampanha[]>;
  /** Aplica uma mudança de verdade na conta. Chamar só depois dos freios de limites.ts. */
  executar(acao: AcaoAnuncio): Promise<unknown>;
}

export function provedorAtual(): ProvedorAnuncios {
  return provedorWindsor;
}
