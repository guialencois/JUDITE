/**
 * Conexões do workspace, no estilo "Conectar e pronto": a JUDITE tem um app OAuth em cada plataforma,
 * o dono clica em "Conectar", faz login e escolhe a conta. Os tokens ficam criptografados e nunca
 * aparecem na tela. O jeito antigo (cada workspace com o próprio app ou token) fica em "Opções avançadas".
 *
 * Alternativa opcional: a Windsor.ai, com a chave de API da própria empresa. O dono escolhe, plataforma
 * por plataforma, entre "Conexão própria (OAuth)" (padrão) e "Windsor".
 */

import { mccPadraoGoogle, variaveisFaltando } from "@/lib/conexoes/app";
import { googleRetorno, metaRetorno, siteFixado, tiktokRetorno, urlDoSite } from "@/lib/conexoes/config";
import { DIAS_DE_AVISO, diasAteVencer, type ContaDisponivel } from "@/lib/conexoes/plataformas";
import { criptoConfigurada } from "@/lib/cripto";
import { NOME_PLATAFORMA, PLATAFORMAS } from "@/lib/trafego/tipos";
import { lerDadosWindsor, NOME_FONTE } from "@/lib/windsor/conexao";
import { carregarWorkspace } from "../carregar";
import { desconectar, escolherConta, salvarGoogle, salvarGoogleApp, salvarMeta, salvarTikTok, salvarTikTokApp } from "./actions";
import { atualizarContasWindsor, salvarChaveWindsor, salvarFonteWindsor, salvarPresencaWindsor } from "./windsor";

export const dynamic = "force-dynamic";

const ERROS: Record<string, string> = {
  "so-dono": "Só o dono do workspace pode conectar, trocar ou desconectar.",
  "google-app": "O app do Google ainda não está configurado. Veja a caixa \"Configuração do administrador\" no fim da página.",
  "google-app-dados": "Confira os valores: o ID do cliente OAuth termina em .apps.googleusercontent.com.",
  "google-state": "A autorização do Google não pôde ser confirmada (o pedido expirou ou veio de outra aba). Tente de novo.",
  "google-cancelado": "A autorização no Google foi cancelada.",
  "google-token": "O Google não concluiu a autorização.",
  "google-contas": "O Google autorizou, mas a lista de contas não veio:",
  "google-id": "O ID do cliente precisa ter 10 números (ex.: 411-071-3742).",
  "meta-app": "O app da Meta ainda não está configurado. Veja a caixa \"Configuração do administrador\" no fim da página.",
  "meta-state": "A autorização da Meta não pôde ser confirmada (o pedido expirou ou veio de outra aba). Tente de novo.",
  "meta-cancelado": "A autorização na Meta foi cancelada.",
  "meta-token": "A Meta não concluiu a autorização.",
  "meta-contas": "A Meta autorizou, mas a lista de contas não veio:",
  "meta-dados": "Confira o ID da conta de anúncios (só números) e o token.",
  "meta-validacao": "A Meta recusou o token ou a conta. Confira se o usuário do sistema tem acesso a essa conta de anúncios.",
  "conta-escolha": "Escolha uma das contas da lista. Se a lista estiver vazia, conecte de novo.",
  "conta-de-outro": "Essa conta de anúncios já está ligada a outro workspace.",
  salvar: "Não foi possível salvar. Tente de novo.",
  "salvar-tiktok": "Não foi possível salvar a conexão do TikTok. Tente de novo.",
  "salvar-presenca": "Não foi possível salvar a autorização. Tente de novo.",
  "tiktok-app": "O app do TikTok ainda não está configurado. Veja a caixa \"Configuração do administrador\" no fim da página.",
  "tiktok-app-dados": "Confira os valores: o ID do app tem só números e a chave secreta tem letras e números.",
  "tiktok-state": "A autorização do TikTok não pôde ser confirmada (o pedido expirou ou veio de outra aba). Tente de novo.",
  "tiktok-cancelado": "A autorização no TikTok foi cancelada.",
  "tiktok-token": "O TikTok não devolveu o acesso. Confira o app e tente de novo.",
  "tiktok-autorizar": "Conecte o TikTok antes de escolher a conta.",
  "tiktok-dados": "Escolha uma conta de anúncios do TikTok.",
  "tiktok-conta": "Essa conta de anúncios não está entre as que você autorizou no TikTok.",
  "windsor-dados": "Confira a chave da Windsor: cole o valor inteiro, sem espaços.",
  "windsor-chave": "A Windsor recusou essa chave de API. Copie a chave de novo no site da Windsor e tente outra vez.",
  "windsor-fora": "Não foi possível falar com a Windsor agora para conferir a chave. Nada foi alterado; tente de novo em instantes.",
  "windsor-salvar": "Não foi possível salvar. Se a migração da Windsor ainda não foi aplicada no Supabase, aplique-a primeiro (veja docs/PENDENTE.md).",
  "windsor-sem-chave": "Salve a chave da Windsor antes de escolher as contas.",
  "windsor-conta": "Essa conta não está na lista que a Windsor devolveu. Clique em Atualizar lista de contas e escolha de novo.",
  "windsor-escolher": "Para usar a Windsor, marque pelo menos uma conta.",
};
const AVISOS: Record<string, string> = {
  "google-app": "Credenciais do Google salvas (criptografadas).",
  "google-escolher": "Google conectado. Agora escolha a conta de anúncios abaixo.",
  "google-sem-contas": "Google conectado, mas esse e-mail não tem contas de anúncios ativas. Entre com o e-mail que administra os anúncios.",
  "google-sem-token": "Google conectado. Falta o developer token do Google Ads para listar as contas (veja a Configuração do administrador).",
  "google-conta": "Conta do Google Ads escolhida.",
  "meta-escolher": "Meta conectada. Agora escolha a conta de anúncios abaixo.",
  "meta-reconectada": "Meta reconectada. A conta de anúncios continua a mesma.",
  "meta-sem-contas": "Meta conectada, mas esse login não tem contas de anúncios. Entre com o perfil que administra os anúncios.",
  "meta-conectada": "Conta da Meta escolhida e pronta.",
  desconectado: "Conexão removida e tokens apagados da JUDITE.",
  "desconectado-revogado": "Conexão removida: o acesso foi revogado na plataforma e os tokens foram apagados.",
  "presenca-autorizada": "Google autorizado para o Perfil da Empresa e o Search Console. Agora escolha o perfil e o site na página Presença no Google.",
  "tiktok-app": "Credenciais do app do TikTok salvas (criptografadas).",
  "tiktok-autorizado": "TikTok conectado. Agora escolha a conta de anúncios abaixo.",
  "tiktok-conectado": "Conta do TikTok escolhida e pronta.",
  "windsor-salva": "Chave da Windsor conferida e salva (criptografada). Agora escolha, em cada plataforma, se quer usar a Windsor.",
  "windsor-atualizada": "Lista de contas da Windsor atualizada.",
  "windsor-fonte": "Pronto: essa parte passa a usar a Windsor.",
  "windsor-propria": "Pronto: essa parte volta a usar a conexão própria.",
  "windsor-apagada": "Chave da Windsor apagada da JUDITE. Tudo voltou para a conexão própria.",
};

const campo = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";
const botaoNeutro = "rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200";
const codigo = "rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-amber-300 break-all";
const cartao = "space-y-4 rounded-xl border border-zinc-800 p-4";
const alerta = "rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100";
const avancado = "rounded-lg bg-zinc-900/60 p-3";

type Dados = {
  conta?: string | null; cliente?: string | null; nome?: string | null; gerente?: string | null; moeda?: string | null;
  contas_disponiveis?: ContaDisponivel[]; anunciantes?: string[]; aviso_contas?: string | null;
  tem_developer_token?: boolean; tem_app_oauth?: boolean; tem_autorizacao?: boolean;
  precisa_reconectar?: boolean; motivo_reconexao?: string | null; expira_em?: string | null; modo?: string; app_origem?: string;
  local?: string | null; site_gsc?: string | null;
};

function Situacao({ conectada, texto }: { conectada: boolean; texto: string }) {
  return (
    <span className={"rounded-full px-2 py-0.5 text-xs " + (conectada ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-400")}>
      {conectada ? "✓ " : "○ "}{texto}
    </span>
  );
}

function Desconectar({ ws, provedor, rotulo }: { ws: string; provedor: string; rotulo: string }) {
  return (
    <form action={desconectar}>
      <input type="hidden" name="workspaceId" value={ws} />
      <input type="hidden" name="provedor" value={provedor} />
      <button className="text-sm text-zinc-500 hover:text-rose-400">{rotulo}</button>
    </form>
  );
}

/** Lista de contas devolvida pela plataforma no login, para o dono escolher (ou trocar). */
function EscolherConta({ ws, provedor, contas, atual }: { ws: string; provedor: "google_ads" | "meta"; contas: ContaDisponivel[]; atual?: string | null }) {
  return (
    <form action={escolherConta} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="workspaceId" value={ws} />
      <input type="hidden" name="provedor" value={provedor} />
      <label className="text-xs text-zinc-400">Conta de anúncios
        <select name="conta" required defaultValue={contas.some((c) => c.id === atual) ? (atual ?? "") : ""} className={campo}>
          <option value="" disabled>Escolha a conta</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome} · {c.id}{c.moeda ? ` · ${c.moeda}` : ""}{c.gerente ? ` · via ${c.gerente}` : ""}{c.status !== null && c.status !== undefined && c.status !== 1 ? " · inativa" : ""}
            </option>
          ))}
        </select>
      </label>
      <button className={botao}>Usar esta conta</button>
    </form>
  );
}

export default async function ConexoesPage(props: PageProps<"/painel/[workspaceId]/conexoes">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const dono = papel === "owner";
  const ws = workspace.id as string;
  const params = await props.searchParams;
  const motivo = typeof params.motivo === "string" ? params.motivo.slice(0, 200) : "";
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;
  const aviso = typeof params.aviso === "string" ? AVISOS[params.aviso] : undefined;

  const { data: linhas } = await supabase.from("conexoes").select("provedor, dados, conectado_em").eq("workspace_id", ws);
  const linha = (p: string) => linhas?.find((l) => l.provedor === p);
  const google = linha("google_ads");
  const meta = linha("meta");
  const tiktok = linha("tiktok");
  const presenca = linha("google_presenca");
  const g = (google?.dados ?? {}) as Dados;
  const m = (meta?.dados ?? {}) as Dados;
  const t = (tiktok?.dados ?? {}) as Dados;
  const p = (presenca?.dados ?? {}) as Dados;
  const windsor = linha("windsor");
  const w = lerDadosWindsor(windsor?.dados);
  const temWindsor = Boolean(windsor?.conectado_em);

  const cripto = criptoConfigurada();
  const site = await urlDoSite();
  const faltam = variaveisFaltando();
  // O app da plataforma existe quando as variáveis estão no servidor; senão vale o app que o workspace salvou (modo antigo).
  const appGoogleDaPlataforma = !faltam.google.includes("GOOGLE_OAUTH_CLIENT_ID") && !faltam.google.includes("GOOGLE_OAUTH_CLIENT_SECRET");
  const podeGoogle = cripto && (appGoogleDaPlataforma || Boolean(g.tem_app_oauth));
  const temDeveloperToken = !faltam.google.includes("GOOGLE_ADS_DEVELOPER_TOKEN") || Boolean(g.tem_developer_token);
  const podeMeta = cripto && faltam.meta.length === 0;
  const podeTikTok = cripto && (faltam.tiktok.length === 0 || Boolean(t.tem_app_oauth));

  const contasGoogle = Array.isArray(g.contas_disponiveis) ? g.contas_disponiveis : [];
  const contasMeta = Array.isArray(m.contas_disponiveis) ? m.contas_disponiveis : [];
  const contasTikTok = Array.isArray(t.contas_disponiveis) ? t.contas_disponiveis : (t.anunciantes ?? []).map((id) => ({ id, nome: `Anunciante ${id}` }));
  const diasMeta = diasAteVencer(m.expira_em);
  const metaVencida = Boolean(m.precisa_reconectar) || (diasMeta !== null && diasMeta < 0);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-6">
      <header>
        <h1 className="font-serif text-3xl">Conexões</h1>
        <p className="text-sm text-zinc-500">
          Clique em Conectar, entre na plataforma e escolha a conta de anúncios. O padrão é a conexão própria, pelas APIs oficiais.
          Quem já usa a Windsor.ai pode ligar a chave no fim da página e escolher a fonte de cada plataforma.
          {!dono && " Só o dono do workspace pode conectar, trocar ou desconectar."}
        </p>
      </header>

      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}{motivo ? ` ${motivo}` : ""}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}{motivo ? ` ${motivo}` : ""}</p>}

      {!cripto && (
        <p className={alerta}>
          O servidor ainda não tem a chave mestra do Supabase (<code className={codigo}>SUPABASE_SERVICE_ROLE_KEY</code>).
          Sem ela, a JUDITE não consegue guardar tokens com segurança. Cadastre-a na Vercel e no .env.local.
        </p>
      )}

      {/* ------------------------------------------------------------ GOOGLE ADS */}
      <section className={cartao}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-medium">Google Ads</h2>
          <Situacao conectada={Boolean(google?.conectado_em) && !g.precisa_reconectar} texto={g.cliente ? `${g.nome ?? "Conta"} · ${g.cliente}` : g.tem_autorizacao ? "falta escolher a conta" : "não conectado"} />
        </div>

        {g.precisa_reconectar && (
          <p className={alerta}>
            <strong>Precisa reconectar.</strong> O Google recusou a autorização salva (ela venceu ou foi removida na sua conta Google). Clique em Reconectar.
          </p>
        )}
        {!temDeveloperToken && (
          <p className={alerta}>
            Falta o <strong>developer token</strong> do Google Ads. Sem ele dá para fazer o login, mas não para listar contas nem ler campanhas.
            Ele é pedido uma vez na conta de administrador do Google Ads (passo a passo em <code className={codigo}>docs/CONEXOES-OAUTH.md</code>).
          </p>
        )}
        {g.aviso_contas && <p className={alerta}>{g.aviso_contas}</p>}

        {dono && (
          <div className="flex flex-wrap items-center gap-3">
            {podeGoogle ? (
              <a href={`/api/conexoes/google/iniciar?workspaceId=${ws}`} className={g.tem_autorizacao && !g.precisa_reconectar ? botaoNeutro : botao}>
                {g.precisa_reconectar ? "Reconectar com Google" : g.tem_autorizacao ? "Conectar com outro e-mail" : "Conectar com Google"}
              </a>
            ) : <p className="text-sm text-zinc-500">O botão aparece quando o app do Google estiver configurado (veja o fim da página).</p>}
            {google && <Desconectar ws={ws} provedor="google_ads" rotulo="Desconectar" />}
          </div>
        )}

        {dono && g.tem_autorizacao && contasGoogle.length > 0 && (
          g.cliente
            ? <details><summary className="cursor-pointer text-sm text-amber-300">Trocar conta</summary><div className="mt-2"><EscolherConta ws={ws} provedor="google_ads" contas={contasGoogle} atual={g.cliente} /></div></details>
            : <EscolherConta ws={ws} provedor="google_ads" contas={contasGoogle} atual={g.cliente} />
        )}
        {g.gerente && <p className="text-xs text-zinc-500">Acessada pela conta de administrador {g.gerente}.</p>}

        {dono && cripto && (
          <details className={avancado}>
            <summary className="cursor-pointer text-sm font-medium">Opções avançadas</summary>
            <div className="mt-3 space-y-4">
              <p className="text-xs text-zinc-500">
                Use só se a lista de contas não trouxe a sua, ou se este workspace precisa de um app do Google próprio.
                Com o app da JUDITE configurado, nada disto é necessário.
              </p>
              <form action={salvarGoogle} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <input type="hidden" name="workspaceId" value={ws} />
                <label className="text-xs text-zinc-400">ID do cliente (10 números)
                  <input name="cliente" required defaultValue={g.cliente ?? ""} placeholder="411-071-3742" className={campo} />
                </label>
                <label className="text-xs text-zinc-400">ID da conta de administrador (opcional)
                  <input name="gerente" defaultValue={g.gerente ?? ""} placeholder="123-456-7890" className={campo} />
                </label>
                <button className={botaoNeutro}>Salvar à mão</button>
              </form>
              <form action={salvarGoogleApp} className="space-y-2">
                <input type="hidden" name="workspaceId" value={ws} />
                <p className="text-sm font-medium">App próprio deste workspace</p>
                <p className="text-xs text-zinc-500">
                  Ficam criptografados e nunca são mostrados de novo. Campo vazio mantém o valor já salvo.
                  URI de redirecionamento a cadastrar no Google Cloud: <code className={codigo}>{googleRetorno(site)}</code>
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="text-xs text-zinc-400">Developer token
                    <input name="developerToken" type="password" autoComplete="off" placeholder={g.tem_developer_token ? "•••••• salvo" : ""} className={campo} />
                  </label>
                  <label className="text-xs text-zinc-400">ID do cliente OAuth
                    <input name="clientId" type="password" autoComplete="off" placeholder="….apps.googleusercontent.com" className={campo} />
                  </label>
                  <label className="text-xs text-zinc-400">Chave secreta do cliente
                    <input name="clientSecret" type="password" autoComplete="off" className={campo} />
                  </label>
                </div>
                <button className={botaoNeutro}>Salvar credenciais</button>
              </form>
            </div>
          </details>
        )}
      </section>

      {/* ------------------------------------------------------------ PRESENÇA NO GOOGLE */}
      <section className={cartao}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-medium">Presença no Google (Perfil da Empresa e Search Console)</h2>
          <Situacao conectada={Boolean(p.tem_autorizacao) && !p.precisa_reconectar} texto={p.tem_autorizacao ? (p.local || p.site_gsc ? "conectada" : "falta escolher perfil e site") : "não conectada"} />
        </div>

        {p.precisa_reconectar && <p className={alerta}><strong>Precisa reconectar.</strong> O Google recusou a autorização salva. Clique em Reconectar.</p>}
        <p className="text-sm text-zinc-400">
          Usa o mesmo app do Google, mas com uma autorização separada (só Perfil da Empresa e Search Console). A parte do perfil depende
          de o Google aprovar o acesso à Business Profile API; o Search Console funciona sem isso.
        </p>

        {dono && (
          <div className="flex flex-wrap items-center gap-3">
            {podeGoogle ? (
              <a href={`/api/conexoes/google/iniciar?workspaceId=${ws}&alvo=presenca`} className={p.tem_autorizacao && !p.precisa_reconectar ? botaoNeutro : botao}>
                {p.precisa_reconectar ? "Reconectar com Google" : p.tem_autorizacao ? "Conectar com outro e-mail" : "Conectar com Google"}
              </a>
            ) : <p className="text-sm text-zinc-500">O botão aparece quando o app do Google estiver configurado.</p>}
            {p.tem_autorizacao && <a href={`/painel/${ws}/presenca`} className="text-sm text-amber-300 underline">Escolher perfil e site</a>}
            {presenca && <Desconectar ws={ws} provedor="google_presenca" rotulo="Desconectar" />}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ META */}
      <section className={cartao}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-medium">Meta Ads (Facebook e Instagram)</h2>
          <Situacao conectada={Boolean(meta?.conectado_em) && !metaVencida} texto={m.conta ? `${m.nome ?? "Conta"} · ${m.conta}` : m.tem_autorizacao ? "falta escolher a conta" : "não conectada"} />
        </div>

        {metaVencida && (
          <p className={alerta}><strong>Precisa reconectar.</strong> O acesso da Meta venceu ou foi removido. Clique em Reconectar.</p>
        )}
        {!metaVencida && diasMeta !== null && diasMeta <= DIAS_DE_AVISO && (
          <p className={alerta}>
            O acesso da Meta vence {diasMeta <= 0 ? "hoje" : `em ${diasMeta} dia(s)`}. Clique em <strong>Reconectar</strong> para renovar por mais 60 dias; a conta escolhida continua a mesma.
          </p>
        )}
        {m.aviso_contas && <p className={alerta}>{m.aviso_contas}</p>}
        {m.modo === "usuario_sistema" && <p className="text-xs text-zinc-500">Conectada com token de usuário do sistema (opção avançada): não vence.</p>}
        {m.modo === "login" && diasMeta !== null && diasMeta > DIAS_DE_AVISO && <p className="text-xs text-zinc-500">Acesso válido por mais {diasMeta} dias. A JUDITE avisa {DIAS_DE_AVISO} dias antes de vencer.</p>}

        {dono && (
          <div className="flex flex-wrap items-center gap-3">
            {podeMeta ? (
              <a href={`/api/conexoes/meta/iniciar?workspaceId=${ws}`} className={m.tem_autorizacao && !metaVencida && !(diasMeta !== null && diasMeta <= DIAS_DE_AVISO) ? botaoNeutro : botao}>
                {m.tem_autorizacao ? "Reconectar com Facebook" : "Conectar com Facebook"}
              </a>
            ) : <p className="text-sm text-zinc-500">O botão aparece quando o app da Meta estiver configurado (veja o fim da página).</p>}
            {meta && <Desconectar ws={ws} provedor="meta" rotulo="Desconectar" />}
          </div>
        )}

        {dono && m.modo === "login" && contasMeta.length > 0 && (
          m.conta
            ? <details><summary className="cursor-pointer text-sm text-amber-300">Trocar conta</summary><div className="mt-2"><EscolherConta ws={ws} provedor="meta" contas={contasMeta} atual={m.conta} /></div></details>
            : <EscolherConta ws={ws} provedor="meta" contas={contasMeta} atual={m.conta} />
        )}

        {dono && cripto && (
          <details className={avancado}>
            <summary className="cursor-pointer text-sm font-medium">Opções avançadas</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-zinc-500">
                Token de <strong>usuário do sistema</strong> do Gerenciador de Negócios: não vence e não depende do app da JUDITE.
                Em <code className={codigo}>business.facebook.com/settings</code> → Usuários → Usuários do sistema → Gerar token, com as permissões
                {" "}<code className={codigo}>ads_read</code>, <code className={codigo}>ads_management</code> e <code className={codigo}>business_management</code>.
                A JUDITE testa na Meta antes de guardar.
              </p>
              <form action={salvarMeta} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                <input type="hidden" name="workspaceId" value={ws} />
                <label className="text-xs text-zinc-400">ID da conta de anúncios
                  <input name="conta" required defaultValue={m.conta?.replace("act_", "") ?? ""} placeholder="1234567890" className={campo} />
                </label>
                <label className="text-xs text-zinc-400">Token do usuário do sistema
                  <input name="token" type="password" required autoComplete="off" className={campo} />
                </label>
                <button className={botaoNeutro}>Testar e salvar</button>
              </form>
            </div>
          </details>
        )}
      </section>

      {/* ------------------------------------------------------------ TIKTOK */}
      <section className={cartao}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-medium">TikTok Ads</h2>
          <Situacao conectada={Boolean(tiktok?.conectado_em)} texto={t.conta ? `${t.nome ?? "Conta"} · ${t.conta}` : t.tem_autorizacao ? "falta escolher a conta" : "não conectado"} />
        </div>

        {dono && (
          <div className="flex flex-wrap items-center gap-3">
            {podeTikTok ? (
              <a href={`/api/conexoes/tiktok/iniciar?workspaceId=${ws}`} className={t.tem_autorizacao ? botaoNeutro : botao}>
                {t.tem_autorizacao ? "Reconectar com TikTok" : "Conectar com TikTok"}
              </a>
            ) : <p className="text-sm text-zinc-500">O botão aparece quando o app do TikTok estiver configurado (veja o fim da página).</p>}
            {tiktok && <Desconectar ws={ws} provedor="tiktok" rotulo="Desconectar" />}
          </div>
        )}

        {dono && cripto && t.tem_autorizacao && contasTikTok.length > 0 && (
          <details open={!t.conta}>
            <summary className="cursor-pointer text-sm text-amber-300">{t.conta ? "Trocar conta" : "Escolher a conta"}</summary>
            <form action={salvarTikTok} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <input type="hidden" name="workspaceId" value={ws} />
              <label className="text-xs text-zinc-400">Conta de anúncios
                <select name="conta" required defaultValue={t.conta ?? contasTikTok[0].id} className={campo}>
                  {contasTikTok.map((c) => <option key={c.id} value={c.id}>{c.nome} · {c.id}</option>)}
                </select>
              </label>
              <button className={botao}>Usar esta conta</button>
            </form>
          </details>
        )}

        {dono && cripto && (
          <details className={avancado}>
            <summary className="cursor-pointer text-sm font-medium">Opções avançadas</summary>
            <form action={salvarTikTokApp} className="mt-3 space-y-2">
              <input type="hidden" name="workspaceId" value={ws} />
              <p className="text-sm font-medium">App próprio deste workspace</p>
              <p className="text-xs text-zinc-500">
                Ficam criptografados e nunca são mostrados de novo. Campo vazio mantém o valor já salvo.
                Endereço de retorno a cadastrar no app: <code className={codigo}>{tiktokRetorno(site)}</code>
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-zinc-400">App ID
                  <input name="appId" type="password" autoComplete="off" className={campo} />
                </label>
                <label className="text-xs text-zinc-400">Secret
                  <input name="secret" type="password" autoComplete="off" className={campo} />
                </label>
              </div>
              <button className={botaoNeutro}>Salvar credenciais</button>
            </form>
          </details>
        )}
      </section>

      {/* ------------------------------------------------------------ WINDSOR */}
      <section id="windsor" className={cartao}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-medium">Windsor.ai (opcional)</h2>
          <Situacao conectada={temWindsor} texto={temWindsor ? "chave salva" : "não usada"} />
        </div>
        <p className="text-sm text-zinc-400">
          A Windsor é um serviço pago que liga as contas de anúncio por você. Se a sua empresa já tem conta lá, cole a chave de API:
          a JUDITE confere a chave na Windsor, guarda criptografada e passa a poder ler os dados e executar as ações por ela.
          Cada empresa usa a própria chave. As ações continuam passando pelos mesmos freios (limites, aprovação do dono, histórico).
        </p>

        {dono && cripto && (
          <form action={salvarChaveWindsor} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="workspaceId" value={ws} />
            <label className="text-xs text-zinc-400">Chave de API da Windsor
              <input name="chave" type="password" required autoComplete="off" placeholder={temWindsor ? "•••••• salva (cole outra para trocar)" : "cole a chave aqui"} className={campo} />
            </label>
            <button className={temWindsor ? botaoNeutro : botao}>Testar e salvar</button>
          </form>
        )}
        <p className="text-xs text-zinc-500">
          Onde pegar: entre em <code className={codigo}>onboard.windsor.ai</code>, ligue as contas (Google Ads, Facebook Ads, TikTok Ads...) e copie a
          chave em &quot;API Key&quot;. Passo a passo em <code className={codigo}>docs/PENDENTE.md</code>.
        </p>

        {temWindsor && dono && (
          <div className="flex flex-wrap items-center gap-3">
            <form action={atualizarContasWindsor}>
              <input type="hidden" name="workspaceId" value={ws} />
              <button className={botaoNeutro}>Atualizar lista de contas</button>
            </form>
            <Desconectar ws={ws} provedor="windsor" rotulo="Apagar a chave" />
            {w.validadoEm && <span className="text-xs text-zinc-500">Conferida em {w.validadoEm.slice(0, 10).split("-").reverse().join("/")}.</span>}
          </div>
        )}

        {temWindsor && (
          <div className="space-y-3">
            <p className="text-sm font-medium">De onde vem cada plataforma</p>
            {PLATAFORMAS.map((plataforma) => {
              const contas = w.contas[plataforma] ?? [];
              const marcadas = w.escolhidas[plataforma] ?? [];
              const fonte = w.fonte[plataforma] ?? "propria";
              return (
                <form key={plataforma} action={salvarFonteWindsor} className={avancado + " space-y-2"}>
                  <input type="hidden" name="workspaceId" value={ws} />
                  <input type="hidden" name="plataforma" value={plataforma} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">{NOME_PLATAFORMA[plataforma]} <span className="text-xs text-zinc-500">· hoje: {NOME_FONTE[fonte]}</span></p>
                    {dono && (
                      <div className="flex items-center gap-2">
                        <select name="fonte" defaultValue={fonte} aria-label={`Fonte de ${NOME_PLATAFORMA[plataforma]}`} className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100">
                          <option value="propria">Conexão própria (OAuth)</option>
                          <option value="windsor" disabled={!contas.length}>Windsor</option>
                        </select>
                        <button className={botaoNeutro}>Salvar</button>
                      </div>
                    )}
                  </div>
                  {contas.length ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {contas.map((c) => (
                        <label key={c.id} className="flex items-center gap-2 text-xs text-zinc-300">
                          <input type="checkbox" name="contas" value={c.id} defaultChecked={marcadas.includes(c.id)} disabled={!dono} />
                          {c.nome} · {c.id}
                        </label>
                      ))}
                    </div>
                  ) : <p className="text-xs text-zinc-500">Nenhuma conta de {NOME_PLATAFORMA[plataforma]} ligada na Windsor. Ligue lá e clique em &quot;Atualizar lista de contas&quot;.</p>}
                  {fonte === "windsor" && <p className="text-xs text-sky-300">Dados e ações de {NOME_PLATAFORMA[plataforma]} pela Windsor.</p>}
                </form>
              );
            })}

            <form action={salvarPresencaWindsor} className={avancado + " space-y-2"}>
              <input type="hidden" name="workspaceId" value={ws} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">Presença no Google <span className="text-xs text-zinc-500">· hoje: {NOME_FONTE[w.fonte.presenca ?? "propria"]}</span></p>
                {dono && (
                  <div className="flex items-center gap-2">
                    <select name="fonte" defaultValue={w.fonte.presenca ?? "propria"} aria-label="Fonte da Presença no Google" className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100">
                      <option value="propria">Conexão própria (OAuth)</option>
                      <option value="windsor" disabled={!(w.contas.google_my_business?.length || w.contas.searchconsole?.length)}>Windsor (só leitura)</option>
                    </select>
                    <button className={botaoNeutro}>Salvar</button>
                  </div>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-zinc-400">Perfil da Empresa (Windsor)
                  <select name="local" defaultValue={w.escolhidas.google_my_business?.[0] ?? ""} disabled={!dono} className={campo}>
                    <option value="">Não ler o perfil pela Windsor</option>
                    {(w.contas.google_my_business ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </label>
                <label className="text-xs text-zinc-400">Site no Search Console (Windsor)
                  <select name="site" defaultValue={w.escolhidas.searchconsole?.[0] ?? ""} disabled={!dono} className={campo}>
                    <option value="">Não ler o Search Console pela Windsor</option>
                    {(w.contas.searchconsole ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-xs text-zinc-500">
                Pela Windsor a JUDITE só LÊ o perfil e a busca. Responder avaliações e publicar posts continua pela conexão própria do Google, com aprovação do dono.
              </p>
            </form>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ ADMINISTRADOR */}
      {dono && (
        <section className={cartao + " border-zinc-700"}>
          <div>
            <h2 className="text-xl font-medium">Configuração do administrador</h2>
            <p className="text-sm text-zinc-500">
              Só o dono vê esta caixa. É feita uma vez: criar o app da JUDITE em cada plataforma e colar as variáveis na Vercel.
              O passo a passo completo está em <code className={codigo}>docs/CONEXOES-OAUTH.md</code>.
            </p>
          </div>

          {!siteFixado() && (
            <p className={alerta}>
              A variável <code className={codigo}>SITE_URL</code> não está definida. Os endereços abaixo foram montados a partir do endereço que você
              está usando agora; defina <code className={codigo}>SITE_URL</code> com o endereço definitivo do site para eles não mudarem.
            </p>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">URLs de retorno (copie exatamente como estão)</p>
            <ul className="space-y-2 text-sm text-zinc-300">
              <li>Google Cloud → &quot;URIs de redirecionamento autorizados&quot;:<span className="mt-1 block"><code className={codigo}>{googleRetorno(site)}</code></span></li>
              <li>Meta for Developers → &quot;URIs de redirecionamento do OAuth válidos&quot;:<span className="mt-1 block"><code className={codigo}>{metaRetorno(site)}</code></span></li>
              <li>TikTok for Business → &quot;Advertiser redirect URL&quot;:<span className="mt-1 block"><code className={codigo}>{tiktokRetorno(site)}</code></span></li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Variáveis na Vercel (só os nomes; os valores nunca aparecem aqui)</p>
            <ul className="space-y-1 text-sm">
              {([["Google", faltam.google], ["Meta", faltam.meta], ["TikTok", faltam.tiktok]] as const).map(([nome, lista]) => (
                <li key={nome} className={lista.length ? "text-amber-200" : "text-emerald-300"}>
                  {lista.length
                    ? <>○ {nome}: falta {lista.map((v, i) => <span key={v}>{i ? ", " : ""}<code className={codigo}>{v}</code></span>)}</>
                    : <>✓ {nome}: variáveis configuradas</>}
                </li>
              ))}
              <li className="text-zinc-400">
                {mccPadraoGoogle()
                  ? <>✓ <code className={codigo}>GOOGLE_ADS_LOGIN_CUSTOMER_ID</code> definida (conta de administrador padrão).</>
                  : <>○ <code className={codigo}>GOOGLE_ADS_LOGIN_CUSTOMER_ID</code> é opcional: os 10 números da conta de administrador (MCC), se você usa uma.</>}
              </li>
            </ul>
            <p className="text-xs text-zinc-500">Depois de colar as variáveis na Vercel, faça um novo deploy (Deployments → Redeploy) para elas valerem.</p>
          </div>
        </section>
      )}

      <p className="text-xs text-zinc-500">
        Depois de conectar (ou de trocar a fonte), abra Tráfego e clique em Sincronizar dados. Desconectar revoga o acesso na plataforma (Google e Meta) e apaga os tokens da JUDITE.
      </p>
    </main>
  );
}
