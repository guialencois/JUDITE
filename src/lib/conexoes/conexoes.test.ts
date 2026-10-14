import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provedorGoogle } from "@/lib/anuncios/google";
import { provedorMeta } from "@/lib/anuncios/meta";
import { appGoogle, appMeta, appTikTok, developerTokenGoogle, mccPadraoGoogle, variaveisFaltando } from "./app";
import { desafioPkce, lerCookieOAuth, novoPedidoOAuth, stateConfere } from "./oauth";
import {
  diasAteVencer, ehRevogacaoGoogle, ehRevogacaoMeta, escolherEntre, listarContasGoogle, listarContasMeta, listarContasTikTok,
  provaDoApp, revogarNaPlataforma, trocarCodigoGoogle, trocarCodigoMeta,
} from "./plataformas";

const WS = "22222222-2222-4222-8222-222222222222";
type Chamada = { url: string; init: RequestInit | undefined };

/** fetch simulado: cada resposta é escolhida pelo endereço pedido. */
function simular(responder: (url: string, init?: RequestInit) => { status?: number; corpo: unknown }) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (entrada, init) => {
    const url = String(entrada);
    chamadas.push({ url, init });
    const r = responder(url, init);
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }));
  return chamadas;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("state e PKCE", () => {
  it("o desafio PKCE é o SHA-256 do verificador em base64url (vetor da RFC 7636)", () => {
    expect(desafioPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("cada pedido tem state e verificador novos, no tamanho que o padrão exige", () => {
    const a = novoPedidoOAuth();
    const b = novoPedidoOAuth();
    expect(a.state).not.toBe(b.state);
    expect(a.verificador).not.toBe(b.verificador);
    expect(a.verificador.length).toBeGreaterThanOrEqual(43);
    expect(a.verificador.length).toBeLessThanOrEqual(128);
    expect(a.desafio).toBe(desafioPkce(a.verificador));
    expect(a.desafio).not.toContain(a.verificador);
  });

  it("o state só confere quando é idêntico; vazio ou ausente nunca confere", () => {
    const { state } = novoPedidoOAuth();
    expect(stateConfere(state, state)).toBe(true);
    expect(stateConfere(state.slice(0, -1) + "x", state)).toBe(false);
    expect(stateConfere(state + "a", state)).toBe(false);
    expect(stateConfere("", state)).toBe(false);
    expect(stateConfere(null, state)).toBe(false);
    expect(stateConfere(state, undefined)).toBe(false);
  });

  it("cookie quebrado, incompleto ou de outro formato é recusado", () => {
    const p = novoPedidoOAuth();
    expect(lerCookieOAuth(JSON.stringify({ state: p.state, verificador: p.verificador, workspaceId: WS, alvo: "presenca" })))
      .toEqual({ state: p.state, verificador: p.verificador, workspaceId: WS, alvo: "presenca" });
    expect(lerCookieOAuth(JSON.stringify({ state: p.state, workspaceId: WS }))?.alvo).toBe("ads");
    expect(lerCookieOAuth(undefined)).toBeNull();
    expect(lerCookieOAuth("isto não é json")).toBeNull();
    expect(lerCookieOAuth(JSON.stringify({ state: "curto", workspaceId: WS }))).toBeNull();
    expect(lerCookieOAuth(JSON.stringify({ state: p.state, workspaceId: "nao-e-uuid" }))).toBeNull();
    expect(lerCookieOAuth(JSON.stringify({ state: p.state, workspaceId: WS, verificador: "pequeno" }))).toBeNull();
  });
});

describe("credenciais do app da plataforma", () => {
  const env = { GOOGLE_OAUTH_CLIENT_ID: "id-plataforma", GOOGLE_OAUTH_CLIENT_SECRET: "seg-plataforma" };
  const salvo = { client_id: "id-workspace", client_secret: "seg-workspace", developer_token: "dev-workspace" };

  it("usa a variável de ambiente; sem ela, cai no valor salvo pelo workspace", () => {
    expect(appGoogle(salvo, undefined, env)).toEqual({ clientId: "id-plataforma", clientSecret: "seg-plataforma", origem: "plataforma" });
    expect(appGoogle(salvo, undefined, {})).toEqual({ clientId: "id-workspace", clientSecret: "seg-workspace", origem: "workspace" });
    expect(appGoogle({}, undefined, {})).toBeNull();
    expect(appGoogle({}, undefined, { GOOGLE_OAUTH_CLIENT_ID: "só o id" })).toBeNull();
  });

  it("token emitido pelo app do workspace continua usando o app do workspace", () => {
    expect(appGoogle(salvo, "workspace", env)?.origem).toBe("workspace");
    expect(appGoogle({}, "workspace", env)?.origem).toBe("plataforma");
    expect(appTikTok({ app_id: "1", secret: "s" }, "workspace", { TIKTOK_APP_ID: "9", TIKTOK_APP_SECRET: "z" })).toEqual({ id: "1", segredo: "s", origem: "workspace" });
    expect(appTikTok({}, undefined, { TIKTOK_APP_ID: "9", TIKTOK_APP_SECRET: "z" })?.origem).toBe("plataforma");
  });

  it("developer token e MCC: ambiente primeiro; MCC só vale com 10 números", () => {
    expect(developerTokenGoogle(salvo, { GOOGLE_ADS_DEVELOPER_TOKEN: "dev-plataforma" })).toBe("dev-plataforma");
    expect(developerTokenGoogle(salvo, {})).toBe("dev-workspace");
    expect(developerTokenGoogle({}, {})).toBeNull();
    expect(mccPadraoGoogle({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: "123-456-7890" })).toBe("1234567890");
    expect(mccPadraoGoogle({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: "123" })).toBeNull();
    expect(appMeta({ META_APP_ID: "1" })).toBeNull();
  });

  it("a lista do que falta traz só nomes de variáveis, nunca valores", () => {
    const faltam = variaveisFaltando({ ...env, META_APP_ID: "valor-secreto-123", TIKTOK_APP_ID: "  " });
    expect(faltam).toEqual({ google: ["GOOGLE_ADS_DEVELOPER_TOKEN"], meta: ["META_APP_SECRET"], tiktok: ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"] });
    expect(JSON.stringify(faltam)).not.toContain("valor-secreto-123");
  });
});

describe("Google: troca do código e escolha de conta", () => {
  it("manda o verificador PKCE na troca do código e nunca põe o segredo na URL", async () => {
    const chamadas = simular(() => ({ corpo: { access_token: "acesso", refresh_token: "permanente" } }));
    const r = await trocarCodigoGoogle({ code: "codigo", clientId: "id", clientSecret: "segredo-do-app", redirectUri: "https://site/api/conexoes/google/callback", verificador: "v".repeat(64) });
    expect(r).toEqual({ ok: true, valor: { refreshToken: "permanente", accessToken: "acesso" } });
    const corpo = String(chamadas[0].init?.body);
    expect(corpo).toContain("code_verifier=" + "v".repeat(64));
    expect(corpo).toContain("grant_type=authorization_code");
    expect(chamadas[0].url).not.toContain("segredo-do-app");
  });

  it("sem refresh token ou com código recusado, explica sem expor nada", async () => {
    simular(() => ({ corpo: { access_token: "acesso" } }));
    const sem = await trocarCodigoGoogle({ code: "c", clientId: "id", clientSecret: "segredo-do-app", redirectUri: "x" });
    expect(sem).toMatchObject({ ok: false });
    expect(!sem.ok && sem.motivo).toContain("acesso permanente");
    simular(() => ({ status: 400, corpo: { error: "invalid_grant", error_description: "Bad Request segredo-do-app" } }));
    const recusado = await trocarCodigoGoogle({ code: "c", clientId: "id", clientSecret: "segredo-do-app", redirectUri: "x" });
    expect(!recusado.ok && recusado.motivo).not.toContain("segredo-do-app");
  });

  it("lista as contas diretas e as contas-clientes de uma MCC, sem as contas de administrador", async () => {
    const chamadas = simular((url) => {
      if (url.endsWith("customers:listAccessibleCustomers")) return { corpo: { resourceNames: ["customers/1111111111", "customers/2222222222"] } };
      if (url.includes("/customers/1111111111/")) {
        return { corpo: { results: [
          { customerClient: { id: "1111111111", descriptiveName: "Agência (MCC)", manager: true, level: "0" } },
          { customerClient: { id: "3333333333", descriptiveName: "Guia Lençóis", manager: false, level: "1", currencyCode: "BRL" } },
        ] } };
      }
      return { corpo: { results: [{ customerClient: { id: "2222222222", descriptiveName: "Conta direta", manager: false, level: "0", currencyCode: "BRL" } }] } };
    });
    const r = await listarContasGoogle({ accessToken: "acesso", developerToken: "dev" });
    expect(r).toEqual({ ok: true, valor: [
      { id: "333-333-3333", nome: "Guia Lençóis", moeda: "BRL", gerente: "111-111-1111" },
      { id: "222-222-2222", nome: "Conta direta", moeda: "BRL", gerente: null },
    ] });
    const cabecalhos = chamadas[1].init?.headers as Record<string, string>;
    expect(cabecalhos["developer-token"]).toBe("dev");
    expect(cabecalhos["login-customer-id"]).toBe("1111111111");
    expect(String(chamadas[1].init?.body)).toContain("customer_client.level <= 1");
  });

  it("developer token em acesso de teste vira explicação clara", async () => {
    simular(() => ({ status: 403, corpo: { error: { details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" } }] }] } } }));
    const r = await listarContasGoogle({ accessToken: "acesso", developerToken: "dev" });
    expect(!r.ok && r.motivo).toContain("acesso de teste");
  });

  it("só aceita conta que veio na lista da plataforma", () => {
    const lista = [{ id: "333-333-3333", nome: "Guia Lençóis", gerente: "111-111-1111" }, { id: "act_55", nome: "Meta" }];
    expect(escolherEntre(lista, "333-333-3333")).toMatchObject({ nome: "Guia Lençóis", gerente: "111-111-1111" });
    expect(escolherEntre(lista, "999-999-9999")).toBeNull();
    expect(escolherEntre(undefined, "333-333-3333")).toBeNull();
    expect(escolherEntre([{ id: "333-333-3333" }, null, "texto"], "333-333-3333")).toBeNull();
  });
});

describe("Meta: token de longa duração, contas e validade", () => {
  const AGORA = new Date("2026-10-06T12:00:00Z");

  it("troca o código pelo token curto e depois pelo de longa duração, guardando a validade", async () => {
    const chamadas = simular((url) => (url.includes("fb_exchange_token")
      ? { corpo: { access_token: "token-longo", token_type: "bearer", expires_in: 5184000 } }
      : { corpo: { access_token: "token-curto", token_type: "bearer", expires_in: 3600 } }));
    const r = await trocarCodigoMeta({ code: "codigo", appId: "123", appSecret: "seg", redirectUri: "https://site/api/conexoes/meta/callback", agora: AGORA });
    expect(r).toEqual({ ok: true, valor: { token: "token-longo", expiraEm: "2026-12-05T12:00:00.000Z" } });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].url).toContain("grant_type=fb_exchange_token");
    expect(chamadas[1].url).toContain("fb_exchange_token=token-curto");
  });

  it("appsecret_proof é o HMAC-SHA256 do token com a chave do app, e vai em toda chamada", async () => {
    expect(provaDoApp("token", "segredo")).toBe(createHmac("sha256", "segredo").update("token").digest("hex"));
    const chamadas = simular(() => ({ corpo: { data: [
      { account_id: "55", name: "Guia Lençóis", currency: "BRL", account_status: 1 }, { account_id: "66", name: "", currency: "USD", account_status: 2 },
    ] } }));
    const r = await listarContasMeta({ token: "token", appSecret: "segredo" });
    expect(r).toEqual({ ok: true, valor: [
      { id: "act_55", nome: "Guia Lençóis", moeda: "BRL", status: 1 }, { id: "act_66", nome: "Conta 66", moeda: "USD", status: 2 },
    ] });
    expect(chamadas[0].url).toContain("appsecret_proof=" + provaDoApp("token", "segredo"));
    expect(chamadas[0].url).not.toContain("access_token");
    expect((chamadas[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("token vencido: a Meta responde código 190 e a conexão é marcada para reconectar", async () => {
    expect(ehRevogacaoMeta({ error: { code: 190, message: "Error validating access token: Session has expired" } })).toBe(true);
    expect(ehRevogacaoMeta({ error: { code: 100 } })).toBe(false);
    simular(() => ({ status: 400, corpo: { error: { code: 190, message: "Session has expired" } } }));
    const aoRevogar = vi.fn(async () => undefined);
    const provedor = provedorMeta({ token: "token-vencido", appSecret: "segredo", aoRevogar });
    const erro = await provedor.lerCampanhas({ plataforma: "facebook", contas: ["act_55"], de: "2026-10-01", ate: "2026-10-05" }).then(() => null, (e: Error) => e);
    expect(erro?.message).toContain("Reconectar");
    expect(erro?.message).not.toContain("token-vencido");
    expect(aoRevogar).toHaveBeenCalledTimes(1);
  });

  it("erro comum da Meta não marca a conexão", async () => {
    simular(() => ({ status: 400, corpo: { error: { code: 100, message: "Parâmetro inválido" } } }));
    const aoRevogar = vi.fn(async () => undefined);
    const provedor = provedorMeta({ token: "t", aoRevogar });
    await provedor.lerCampanhas({ plataforma: "facebook", contas: ["act_55"], de: "2026-10-01", ate: "2026-10-05" }).catch(() => null);
    expect(aoRevogar).not.toHaveBeenCalled();
  });

  it("conta os dias até vencer e avisa com antecedência", () => {
    expect(diasAteVencer("2026-10-20T12:00:00Z", AGORA)).toBe(14);
    expect(diasAteVencer("2026-10-11T12:00:00Z", AGORA)).toBe(5);
    expect(diasAteVencer("2026-10-06T11:00:00Z", AGORA)).toBe(-1);
    expect(diasAteVencer(null, AGORA)).toBeNull();
    expect(diasAteVencer("data ruim", AGORA)).toBeNull();
  });
});

describe("Google: autorização revogada", () => {
  it("invalid_grant ao renovar o acesso marca a conexão para reconectar e não vaza o refresh token", async () => {
    expect(ehRevogacaoGoogle({ error: "invalid_grant" })).toBe(true);
    simular(() => ({ status: 400, corpo: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }));
    const aoRevogar = vi.fn(async () => undefined);
    const provedor = provedorGoogle({ developerToken: "dev", clientId: "id", clientSecret: "seg", refreshToken: "refresh-secreto", aoRevogar });
    const erro = await provedor.lerCampanhas({ plataforma: "google_ads", contas: ["333-333-3333"], de: "2026-10-01", ate: "2026-10-05" }).then(() => null, (e: Error) => e);
    expect(erro?.message).toContain("Reconectar");
    expect(erro?.message).not.toContain("refresh-secreto");
    expect(aoRevogar).toHaveBeenCalledTimes(1);
  });

  it("outro erro do Google (app errado) não marca a conexão", async () => {
    simular(() => ({ status: 401, corpo: { error: "invalid_client" } }));
    const aoRevogar = vi.fn(async () => undefined);
    const provedor = provedorGoogle({ developerToken: "dev", clientId: "id", clientSecret: "seg", refreshToken: "r", aoRevogar });
    await provedor.lerCampanhas({ plataforma: "google_ads", contas: ["333-333-3333"], de: "2026-10-01", ate: "2026-10-05" }).catch(() => null);
    expect(aoRevogar).not.toHaveBeenCalled();
  });
});

describe("TikTok: anunciantes autorizados", () => {
  it("lista os anunciantes com nome, mandando o token no cabeçalho", async () => {
    const chamadas = simular(() => ({ corpo: { code: 0, data: { list: [{ advertiser_id: "7000000000000000001", advertiser_name: "Guia Lençóis" }] } } }));
    expect(await listarContasTikTok({ token: "token", appId: "9", secret: "s" })).toEqual({ ok: true, valor: [{ id: "7000000000000000001", nome: "Guia Lençóis" }] });
    expect(chamadas[0].url).toContain("/oauth2/advertiser/get/");
    expect((chamadas[0].init?.headers as Record<string, string>)["Access-Token"]).toBe("token");
    simular(() => ({ corpo: { code: 40105, message: "token inválido" } }));
    expect((await listarContasTikTok({ token: "token", appId: "9", secret: "s" })).ok).toBe(false);
  });
});

describe("desconectar: revogar na plataforma", () => {
  const base = { dados: {}, segredoDoAppMeta: "segredo", outraConexaoGoogleAtiva: false };

  it("Google: revoga o refresh token no endpoint oficial", async () => {
    const chamadas = simular(() => ({ corpo: {} }));
    const r = await revogarNaPlataforma({ ...base, provedor: "google_ads", segredos: { refresh_token: "refresh-secreto" } });
    expect(r.revogado).toBe(true);
    expect(chamadas[0].url).toBe("https://oauth2.googleapis.com/revoke");
    expect(chamadas[0].init?.method).toBe("POST");
    expect(String(chamadas[0].init?.body)).toBe("token=refresh-secreto");
  });

  it("Google: token que já estava revogado conta como revogado; falha de rede não trava o desconectar", async () => {
    simular(() => ({ status: 400, corpo: { error: "invalid_token" } }));
    expect((await revogarNaPlataforma({ ...base, provedor: "google_presenca", segredos: { refresh_token: "r" } })).revogado).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede refresh-secreto"); }));
    const falhou = await revogarNaPlataforma({ ...base, provedor: "google_ads", segredos: { refresh_token: "refresh-secreto" } });
    expect(falhou.revogado).toBe(false);
    expect(falhou.detalhe).not.toContain("refresh-secreto");
  });

  it("Google: não revoga quando a outra conexão do Google ainda usa a mesma autorização", async () => {
    const chamadas = simular(() => ({ corpo: {} }));
    const r = await revogarNaPlataforma({ ...base, provedor: "google_ads", segredos: { refresh_token: "r" }, outraConexaoGoogleAtiva: true });
    expect(r.revogado).toBe(false);
    expect(r.detalhe).toContain("desconecte as duas");
    expect(chamadas).toHaveLength(0);
  });

  it("Meta: DELETE /me/permissions com appsecret_proof, só para o login pelo app da JUDITE", async () => {
    const chamadas = simular(() => ({ corpo: { success: true } }));
    const r = await revogarNaPlataforma({ ...base, provedor: "meta", segredos: { token: "token" }, dados: { modo: "login" } });
    expect(r.revogado).toBe(true);
    expect(chamadas[0].init?.method).toBe("DELETE");
    expect(chamadas[0].url).toContain("/me/permissions?appsecret_proof=" + provaDoApp("token", "segredo"));
    expect(chamadas[0].url).not.toContain("access_token");

    const sistema = simular(() => ({ corpo: { success: true } }));
    const r2 = await revogarNaPlataforma({ ...base, provedor: "meta", segredos: { token: "token" }, dados: { modo: "usuario_sistema" } });
    expect(r2.revogado).toBe(false);
    expect(sistema).toHaveLength(0);
  });

  it("sem token salvo, não chama a plataforma", async () => {
    const chamadas = simular(() => ({ corpo: {} }));
    expect((await revogarNaPlataforma({ ...base, provedor: "google_ads", segredos: {} })).revogado).toBe(false);
    expect((await revogarNaPlataforma({ ...base, provedor: "meta", segredos: {}, dados: { modo: "login" } })).revogado).toBe(false);
    expect((await revogarNaPlataforma({ ...base, provedor: "tiktok", segredos: { access_token: "t" } })).revogado).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
});
