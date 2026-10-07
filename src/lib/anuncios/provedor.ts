/**
 * A "porta" entre a JUDITE e as plataformas de anúncio.
 *
 * As telas e as rotas só conhecem esta interface. Cada plataforma tem o seu provedor
 * nativo (API oficial, por OAuth), que é o padrão. O dono do workspace pode trocar, plataforma
 * por plataforma, para a Windsor.ai (com a chave de API da própria empresa) na página Conexões.
 * Quando o LUNIKO assumir a execução, basta criar outro provedor com os mesmos métodos:
 * telas, freios de orçamento e histórico continuam iguais.
 *
 * Roda SOMENTE no servidor.
 */

import { appGoogle, appMeta, developerTokenGoogle, mccPadraoGoogle } from "@/lib/conexoes/app";
import { lerConexao, marcarReconexao } from "@/lib/conexoes/segredos";
import { CONEXAO_DA_PLATAFORMA } from "@/lib/conexoes/status";
import type { createAdminClient } from "@/lib/supabase/admin";
import { NOME_PLATAFORMA, type AcaoAnuncio, type LinhaCampanha, type LinhaMetrica, type Plataforma } from "@/lib/trafego/tipos";
import { provedorGoogle } from "./google";
import { provedorMeta } from "./meta";
import { contasEscolhidas, fonteDaPlataforma } from "@/lib/windsor/conexao";
import { provedorTikTok } from "./tiktok";
import { provedorWindsor } from "./windsor";

type Admin = ReturnType<typeof createAdminClient>;

export type Periodo = { plataforma: Plataforma; contas: string[]; de: string; ate: string };

/** Pedido de criação de campanha (Campaign Manager). A campanha SEMPRE nasce pausada. */
export type NovaCampanha = {
  conta: string;
  nome: string;
  objetivo: "trafego" | "mensagens" | "conversoes" | "reconhecimento";
  orcamentoDiarioReais: number;
};

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
  /**
   * Cria só a "casca" da campanha (nome, objetivo, orçamento), PAUSADA. Conjuntos de anúncios e
   * anúncios são finalizados na plataforma. Opcional: nem toda plataforma tem isso pela JUDITE ainda.
   * Chamar só depois da aprovação do dono (src/lib/campanhas/publicar.ts).
   */
  criarCampanhaPausada?(c: NovaCampanha): Promise<{ campanhaId: string }>;
}

export type Resolucao = { ok: true; provedor: ProvedorAnuncios } | { ok: false; motivo: string };

/**
 * Monta o provedor da plataforma com as credenciais do workspace.
 * Sem conexão pronta devolve um motivo em português, para a tela e o histórico mostrarem.
 * Chamar só depois de conferir quem está pedindo (os segredos saem abertos daqui).
 */
export async function provedorDoWorkspace(db: Admin, workspaceId: string, plataforma: Plataforma): Promise<Resolucao> {
  const nome = NOME_PLATAFORMA[plataforma];

  // O dono escolheu a Windsor para esta plataforma? Então leitura e ações vão por ela, sem cair
  // escondido na conexão própria: se faltar algo, a tela mostra o que falta.
  let windsor: Awaited<ReturnType<typeof lerConexao>>;
  try {
    windsor = await lerConexao(db, workspaceId, "windsor");
  } catch {
    return { ok: false, motivo: "Não foi possível abrir a chave da Windsor. Salve a chave de novo na página Conexões." };
  }
  if (fonteDaPlataforma(windsor.dados, plataforma) === "windsor") {
    if (!windsor.segredos.api_key) return { ok: false, motivo: `${nome} está configurado para usar a Windsor, mas a chave não está salva. Salve a chave em Conexões.` };
    const contas = contasEscolhidas(windsor.dados, plataforma);
    if (!contas.length) return { ok: false, motivo: `Escolha em Conexões quais contas de ${nome} da Windsor a JUDITE deve usar.` };
    return { ok: true, provedor: provedorWindsor({ chave: windsor.segredos.api_key, plataforma, contas }) };
  }

  let conexao: Awaited<ReturnType<typeof lerConexao>>;
  try {
    conexao = await lerConexao(db, workspaceId, CONEXAO_DA_PLATAFORMA[plataforma]);
  } catch {
    return { ok: false, motivo: `Não foi possível abrir a conexão de ${nome}. Refaça a conexão na página Conexões.` };
  }
  const { segredos, dados } = conexao;

  if (plataforma === "facebook") {
    if (!segredos.token || !dados.conta) return { ok: false, motivo: "Conecte a Meta em Conexões para ler e mudar as campanhas." };
    if (dados.precisa_reconectar) return { ok: false, motivo: "A autorização da Meta venceu ou foi revogada. Clique em \"Reconectar\" em Conexões." };
    // O appsecret_proof só vale para token emitido pelo app da JUDITE (login pelo botão "Conectar com Facebook").
    const app = dados.app_origem === "plataforma" ? appMeta() : null;
    return {
      ok: true,
      provedor: provedorMeta({
        token: segredos.token, moeda: typeof dados.moeda === "string" ? dados.moeda : null, appSecret: app?.segredo ?? null,
        aoRevogar: () => marcarReconexao(db, workspaceId, "meta", "A Meta recusou o token (vencido ou revogado)."),
      }),
    };
  }

  if (plataforma === "google_ads") {
    const app = appGoogle(segredos, dados.app_origem);
    const developerToken = developerTokenGoogle(segredos);
    if (!app) return { ok: false, motivo: "O app do Google ainda não está configurado (veja a caixa \"Configuração do administrador\" em Conexões)." };
    if (!segredos.refresh_token) return { ok: false, motivo: "Conecte o Google Ads em Conexões (botão \"Conectar com Google\")." };
    if (dados.precisa_reconectar) return { ok: false, motivo: "A autorização do Google venceu ou foi revogada. Clique em \"Reconectar\" em Conexões." };
    if (!developerToken) {
      return { ok: false, motivo: "Falta o developer token do Google Ads (GOOGLE_ADS_DEVELOPER_TOKEN). Ele depende de aprovação do Google." };
    }
    if (!dados.cliente) return { ok: false, motivo: "Escolha a conta do Google Ads em Conexões." };
    return {
      ok: true,
      provedor: provedorGoogle({
        developerToken,
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        refreshToken: segredos.refresh_token,
        gerente: typeof dados.gerente === "string" && dados.gerente ? dados.gerente : mccPadraoGoogle(),
        aoRevogar: () => marcarReconexao(db, workspaceId, "google_ads", "O Google recusou a autorização (vencida ou revogada)."),
      }),
    };
  }

  if (plataforma === "tiktok") {
    if (!segredos.access_token || !dados.conta) return { ok: false, motivo: "Conecte o TikTok em Conexões para ler e mudar as campanhas." };
    return { ok: true, provedor: provedorTikTok({ token: segredos.access_token, moeda: typeof dados.moeda === "string" ? dados.moeda : null }) };
  }

  return { ok: false, motivo: `A leitura nativa de ${nome} ainda não está disponível.` };
}
