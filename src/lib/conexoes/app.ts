/**
 * Credenciais do APP da JUDITE em cada plataforma (um app OAuth da própria JUDITE, no estilo "Conectar e pronto").
 * Vêm de variáveis de ambiente, SOMENTE no servidor: nunca vão para o navegador nem para log.
 *
 * Compatibilidade: sem a variável, vale o valor que o workspace salvou no formulário de "Opções avançadas".
 * Um token só funciona com o app que o emitiu; por isso a conexão guarda em dados.app_origem de qual
 * app o token veio ("plataforma" ou "workspace") e as chamadas seguintes usam esse mesmo app.
 */

export type OrigemDoApp = "plataforma" | "workspace";
type Ambiente = Record<string, string | undefined>;
type Segredos = Record<string, string | undefined>;

const ler = (env: Ambiente, nome: string): string | undefined => env[nome]?.trim() || undefined;

export type AppGoogle = { clientId: string; clientSecret: string; origem: OrigemDoApp };
export type AppSimples = { id: string; segredo: string; origem: OrigemDoApp };

function escolher<T>(daPlataforma: T | null, doWorkspace: T | null, preferida?: unknown): T | null {
  // Token emitido pelo app do workspace continua usando o app do workspace, mesmo depois de a variável existir.
  if (preferida === "workspace" && doWorkspace) return doWorkspace;
  return daPlataforma ?? doWorkspace;
}

/** App OAuth do Google (serve para o Google Ads e para a Presença no Google). */
export function appGoogle(segredos: Segredos, origemPreferida?: unknown, env: Ambiente = process.env): AppGoogle | null {
  const id = ler(env, "GOOGLE_OAUTH_CLIENT_ID");
  const segredo = ler(env, "GOOGLE_OAUTH_CLIENT_SECRET");
  return escolher<AppGoogle>(
    id && segredo ? { clientId: id, clientSecret: segredo, origem: "plataforma" } : null,
    segredos.client_id && segredos.client_secret ? { clientId: segredos.client_id, clientSecret: segredos.client_secret, origem: "workspace" } : null,
    origemPreferida,
  );
}

/** Developer token do Google Ads: o da plataforma, senão o salvo pelo workspace. */
export function developerTokenGoogle(segredos: Segredos, env: Ambiente = process.env): string | null {
  return ler(env, "GOOGLE_ADS_DEVELOPER_TOKEN") ?? segredos.developer_token ?? null;
}

/** Conta de administrador (MCC) padrão da plataforma, só com os 10 números. Opcional. */
export function mccPadraoGoogle(env: Ambiente = process.env): string | null {
  const digitos = (ler(env, "GOOGLE_ADS_LOGIN_CUSTOMER_ID") ?? "").replace(/\D/g, "");
  return digitos.length === 10 ? digitos : null;
}

/** App da Meta (Facebook Login). Não existe versão "do workspace": no modo avançado o dono cola um token de usuário do sistema. */
export function appMeta(env: Ambiente = process.env): AppSimples | null {
  const id = ler(env, "META_APP_ID");
  const segredo = ler(env, "META_APP_SECRET");
  return id && segredo ? { id, segredo, origem: "plataforma" } : null;
}

export function appTikTok(segredos: Segredos, origemPreferida?: unknown, env: Ambiente = process.env): AppSimples | null {
  const id = ler(env, "TIKTOK_APP_ID");
  const segredo = ler(env, "TIKTOK_APP_SECRET");
  return escolher<AppSimples>(
    id && segredo ? { id, segredo, origem: "plataforma" } : null,
    segredos.app_id && segredos.secret ? { id: segredos.app_id, segredo: segredos.secret, origem: "workspace" } : null,
    origemPreferida,
  );
}

export const VARIAVEIS_DO_APP = {
  google: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
  meta: ["META_APP_ID", "META_APP_SECRET"],
  tiktok: ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"],
} as const;
export type PlataformaDoApp = keyof typeof VARIAVEIS_DO_APP;

/** Só os NOMES das variáveis que faltam em cada plataforma. Os valores nunca saem daqui. */
export function variaveisFaltando(env: Ambiente = process.env): Record<PlataformaDoApp, string[]> {
  const faltam = (nomes: readonly string[]) => nomes.filter((n) => !ler(env, n));
  return { google: faltam(VARIAVEIS_DO_APP.google), meta: faltam(VARIAVEIS_DO_APP.meta), tiktok: faltam(VARIAVEIS_DO_APP.tiktok) };
}
