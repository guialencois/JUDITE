/**
 * Conexões do workspace: status de cada plataforma, passo a passo para conectar
 * e formulários (só o dono). Os tokens nunca aparecem na tela depois de salvos.
 */

import { googleRetorno, urlDoSite } from "@/lib/conexoes/config";
import { criptoConfigurada } from "@/lib/cripto";
import { carregarWorkspace } from "../carregar";
import { desconectar, salvarGoogle, salvarGoogleApp, salvarMeta } from "./actions";

export const dynamic = "force-dynamic";

const ERROS: Record<string, string> = {
  "so-dono": "Só o dono do workspace pode mexer nas conexões.",
  "google-app": "Salve primeiro o ID do cliente OAuth e a chave secreta do app Google (Parte B).",
  "google-app-dados": "Confira os valores: o ID do cliente OAuth termina em .apps.googleusercontent.com.",
  "google-state": "A autorização do Google não pôde ser confirmada. Tente de novo.",
  "google-cancelado": "A autorização no Google foi cancelada.",
  "google-token": "O Google não devolveu o acesso permanente. Tente de novo; se repetir, remova o acesso da JUDITE em myaccount.google.com/permissions e conecte outra vez.",
  "google-id": "O ID do cliente precisa ter 10 números (ex.: 411-071-3742).",
  "meta-dados": "Confira o ID da conta de anúncios (só números) e o token.",
  "meta-validacao": "A Meta recusou o token ou a conta. Confira se o usuário do sistema tem acesso a essa conta de anúncios.",
  "conta-de-outro": "Essa conta de anúncios já está ligada a outro workspace.",
  salvar: "Não foi possível salvar. Tente de novo.",
};
const AVISOS: Record<string, string> = {
  "google-app": "Credenciais do Google salvas (criptografadas).",
  "google-autorizado": "Google autorizado. Agora informe o ID do cliente, se ainda não informou.",
  "google-conta": "ID do cliente do Google Ads salvo.",
  "meta-conectada": "Meta Ads conectada e testada com sucesso.",
  desconectado: "Conexão removida. O token foi apagado.",
};

const campo = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";
const passo = "space-y-1 text-sm text-zinc-300";
const codigo = "rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-amber-300 break-all";

function Selo({ ok, sim, nao }: { ok: boolean; sim: string; nao: string }) {
  return (
    <span className={"rounded-full px-2 py-0.5 text-xs " + (ok ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-400")}>
      {ok ? "✓ " + sim : "○ " + nao}
    </span>
  );
}

export default async function ConexoesPage(props: PageProps<"/painel/[workspaceId]/conexoes">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const dono = papel === "owner";
  const params = await props.searchParams;
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;
  const aviso = typeof params.aviso === "string" ? AVISOS[params.aviso] : undefined;

  const { data: linhas } = await supabase
    .from("conexoes")
    .select("provedor, dados, conectado_em")
    .eq("workspace_id", workspace.id);
  const google = linhas?.find((l) => l.provedor === "google_ads");
  const meta = linhas?.find((l) => l.provedor === "meta");
  const gDados = (google?.dados ?? {}) as {
    cliente?: string; gerente?: string | null;
    tem_developer_token?: boolean; tem_app_oauth?: boolean; tem_autorizacao?: boolean;
  };
  const mDados = (meta?.dados ?? {}) as { conta?: string; nome?: string; validado_em?: string };

  const app = { developerToken: Boolean(gDados.tem_developer_token), oauth: Boolean(gDados.tem_app_oauth) };
  const cripto = criptoConfigurada();
  const site = await urlDoSite();
  const retorno = googleRetorno(site);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-6">
      <header>
        <h1 className="font-serif text-3xl">Conexões</h1>
        <p className="text-sm text-zinc-500">
          Ligue as contas de anúncio direto na JUDITE, pelas APIs oficiais e gratuitas do Google e da Meta.
          {!dono && " Só o dono do workspace pode conectar ou remover."}
        </p>
      </header>

      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</p>}

      {!cripto && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          O servidor ainda não tem a chave mestra do Supabase (<code className={codigo}>SUPABASE_SERVICE_ROLE_KEY</code>).
          Sem ela, a JUDITE não consegue guardar tokens com segurança. Cadastre-a na Vercel e no .env.local.
        </p>
      )}

      {/* ------------------------------------------------------------ GOOGLE */}
      <section className="space-y-4 rounded-xl border border-zinc-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-medium">Google Ads</h2>
          <div className="flex flex-wrap gap-2">
            <Selo ok={app.developerToken} sim="developer token" nao="developer token" />
            <Selo ok={app.oauth} sim="app OAuth" nao="app OAuth" />
            <Selo ok={Boolean(gDados.tem_autorizacao)} sim="conta autorizada" nao="conta autorizada" />
            <Selo ok={Boolean(gDados.cliente)} sim={"cliente " + (gDados.cliente ?? "")} nao="ID do cliente" />
          </div>
        </div>

        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          A leitura e as ações no Google Ads dependem da <strong>aprovação do developer token</strong> pelo Google (Parte A,
          &quot;Acesso básico&quot;). Enquanto o token estiver em acesso de teste, a sincronização falha com uma mensagem explicando isso;
          nada quebra e as outras plataformas continuam funcionando.
        </p>

        <details className="rounded-lg bg-zinc-900/60 p-3" open={!app.developerToken}>
          <summary className="cursor-pointer text-sm font-medium">Parte A — Developer token (pedido ao Google, uma vez só)</summary>
          <ol className="mt-3 list-decimal space-y-3 pl-5">
            <li className={passo}>
              Você precisa de uma <strong>conta de administrador do Google Ads</strong> (MCC). Se não tiver, crie grátis em
              {" "}<code className={codigo}>ads.google.com/home/tools/manager-accounts</code> e vincule a conta de anúncios a ela.
            </li>
            <li className={passo}>
              Entre na conta de administrador e abra <strong>Administrador → Central de API</strong>
              {" "}(em algumas telas: Ferramentas → Configuração → Central de API).
            </li>
            <li className={passo}>
              Preencha o formulário e aceite os termos. Você recebe um <strong>developer token</strong> com acesso de teste; peça o
              {" "}<strong>Acesso básico</strong> no mesmo lugar para usar com contas reais. A aprovação pode levar de dias a semanas.
            </li>
            <li className={passo}>Quando chegar, cole o developer token no formulário logo abaixo da Parte B.</li>
          </ol>
        </details>

        <details className="rounded-lg bg-zinc-900/60 p-3" open={app.developerToken && !app.oauth}>
          <summary className="cursor-pointer text-sm font-medium">Parte B — App OAuth no Google Cloud (uma vez só)</summary>
          <ol className="mt-3 list-decimal space-y-3 pl-5">
            <li className={passo}>Abra <code className={codigo}>console.cloud.google.com</code> e crie um projeto chamado JUDITE.</li>
            <li className={passo}>Em <strong>APIs e serviços → Biblioteca</strong>, procure <strong>Google Ads API</strong> e clique em Ativar.</li>
            <li className={passo}>
              Em <strong>Tela de permissão OAuth</strong>: tipo <strong>Externo</strong>, nome JUDITE, seu e-mail de suporte.
              Em <strong>Usuários de teste</strong>, adicione o e-mail Google que administra os anúncios.
              <span className="block text-xs text-amber-200">
                Importante: com o app em modo de teste, o Google corta o acesso a cada 7 dias. Depois que a conexão funcionar,
                volte nessa tela e clique em <strong>Publicar app</strong> (colocar em produção).
              </span>
            </li>
            <li className={passo}>
              Em <strong>Credenciais → Criar credenciais → ID do cliente OAuth</strong>, tipo <strong>Aplicativo da Web</strong>.
              Em <strong>URIs de redirecionamento autorizados</strong>, cole exatamente:
              <span className="mt-1 block"><code className={codigo}>{retorno}</code></span>
              <span className="block text-xs text-zinc-500">
                Use o endereço definitivo do site (de produção). Se testar no seu computador, adicione também
                {" "}<code className={codigo}>http://localhost:3000/api/conexoes/google/callback</code>.
              </span>
            </li>
            <li className={passo}>Copie o <strong>ID do cliente</strong> e a <strong>Chave secreta</strong> e cole no formulário abaixo.</li>
          </ol>
        </details>

        {dono && cripto && (
          <form action={salvarGoogleApp} className="space-y-2 rounded-lg border border-zinc-800 p-3">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <p className="text-sm font-medium">Credenciais do Google (Partes A e B)</p>
            <p className="text-xs text-zinc-500">Ficam criptografadas e nunca são mostradas de novo. Deixe um campo vazio para manter o valor já salvo.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-xs text-zinc-400">Developer token
                <input name="developerToken" type="password" autoComplete="off" placeholder={app.developerToken ? "•••••• salvo" : ""} className={campo} />
              </label>
              <label className="text-xs text-zinc-400">ID do cliente OAuth
                <input name="clientId" type="password" autoComplete="off" placeholder={app.oauth ? "•••••• salvo" : "….apps.googleusercontent.com"} className={campo} />
              </label>
              <label className="text-xs text-zinc-400">Chave secreta do cliente
                <input name="clientSecret" type="password" autoComplete="off" placeholder={app.oauth ? "•••••• salvo" : ""} className={campo} />
              </label>
            </div>
            <button className={botao}>Salvar credenciais</button>
          </form>
        )}

        <div className="space-y-3 rounded-lg bg-zinc-900/60 p-3">
          <p className="text-sm font-medium">Parte C — Conectar a conta deste workspace</p>
          <ol className="list-decimal space-y-3 pl-5">
            <li className={passo}>
              Clique em <strong>Autorizar no Google</strong> e entre com o e-mail que administra os anúncios.
              {dono && app.oauth && cripto && (
                <a href={`/api/conexoes/google/iniciar?workspaceId=${workspace.id}`} className={botao + " ml-2 inline-block"}>
                  {gDados.tem_autorizacao ? "Autorizar de novo" : "Autorizar no Google"}
                </a>
              )}
              {!(app.oauth && cripto) && <span className="block text-xs text-zinc-500">Disponível depois de salvar as credenciais da Parte B.</span>}
            </li>
            <li className={passo}>
              Informe o <strong>ID do cliente</strong> (aparece no topo do Google Ads, ex.: 411-071-3742). Se a conta for gerenciada por uma
              conta de administrador, informe também o ID dela.
              {dono && (
                <form action={salvarGoogle} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <label className="text-xs text-zinc-400">ID do cliente
                    <input name="cliente" required defaultValue={gDados.cliente ?? ""} placeholder="411-071-3742" className={campo} />
                  </label>
                  <label className="text-xs text-zinc-400">ID da conta de administrador (opcional)
                    <input name="gerente" defaultValue={gDados.gerente ?? ""} placeholder="123-456-7890" className={campo} />
                  </label>
                  <button className={botao}>Salvar</button>
                </form>
              )}
            </li>
          </ol>
        </div>

        {dono && google && (
          <form action={desconectar}>
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <input type="hidden" name="provedor" value="google_ads" />
            <button className="text-sm text-zinc-500 hover:text-rose-400">Remover conexão do Google Ads</button>
          </form>
        )}
      </section>

      {/* ------------------------------------------------------------ META */}
      <section className="space-y-4 rounded-xl border border-zinc-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-medium">Meta Ads (Facebook e Instagram)</h2>
          <Selo ok={Boolean(meta?.conectado_em)} sim={"conectada" + (mDados.nome ? ": " + mDados.nome : "")} nao="não conectada" />
        </div>

        <details className="rounded-lg bg-zinc-900/60 p-3" open={!meta}>
          <summary className="cursor-pointer text-sm font-medium">Passo a passo</summary>
          <ol className="mt-3 list-decimal space-y-3 pl-5">
            <li className={passo}>
              Abra <code className={codigo}>developers.facebook.com</code> → <strong>Meus apps → Criar app</strong>.
              Escolha o caso de uso de <strong>anúncios / API de Marketing</strong> e ligue o app ao seu <strong>portfólio empresarial</strong>.
            </li>
            <li className={passo}>
              Abra <code className={codigo}>business.facebook.com/settings</code> → <strong>Usuários → Usuários do sistema → Adicionar</strong>.
              Dê o nome JUDITE e a função <strong>Admin</strong>.
            </li>
            <li className={passo}>
              No usuário do sistema, clique em <strong>Atribuir ativos</strong> → <strong>Contas de anúncios</strong> → marque a conta e dê
              {" "}<strong>controle total</strong> (gerenciar campanhas).
            </li>
            <li className={passo}>
              Clique em <strong>Gerar token</strong>, escolha o app criado, validade <strong>Nunca</strong>, e marque as permissões
              {" "}<code className={codigo}>ads_read</code>, <code className={codigo}>ads_management</code> e <code className={codigo}>business_management</code>.
              Copie o token (ele aparece uma vez só).
            </li>
            <li className={passo}>
              O <strong>ID da conta de anúncios</strong> aparece no Gerenciador de Anúncios (número depois de <em>act=</em> no endereço).
            </li>
            <li className={passo}>Cole os dois abaixo. A JUDITE testa na Meta antes de guardar, e o token fica criptografado.</li>
          </ol>
        </details>

        {dono && cripto && (
          <form action={salvarMeta} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <label className="text-xs text-zinc-400">ID da conta de anúncios
              <input name="conta" required defaultValue={mDados.conta?.replace("act_", "") ?? ""} placeholder="1234567890" className={campo} />
            </label>
            <label className="text-xs text-zinc-400">Token do usuário do sistema
              <input name="token" type="password" required autoComplete="off" placeholder={meta ? "•••••• (salvo; cole outro para trocar)" : ""} className={campo} />
            </label>
            <button className={botao}>Testar e salvar</button>
          </form>
        )}

        {dono && meta && (
          <form action={desconectar}>
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <input type="hidden" name="provedor" value="meta" />
            <button className="text-sm text-zinc-500 hover:text-rose-400">Remover conexão da Meta</button>
          </form>
        )}
      </section>

      <p className="text-xs text-zinc-500">
        A JUDITE lê e muda as campanhas direto pelas APIs oficiais de cada plataforma, sem intermediário pago.
        Depois de conectar, abra Tráfego e clique em Sincronizar dados.
      </p>
    </main>
  );
}
