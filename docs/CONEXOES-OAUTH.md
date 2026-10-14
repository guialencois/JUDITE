# Conexões por OAuth — configuração do administrador

> Este passo a passo é feito **uma vez só**, por quem administra a JUDITE (o Jackson).
> Depois dele, o dono de cada workspace só clica em **Conectar**, faz login na plataforma e escolhe a conta.

## Como funciona

A JUDITE tem **um app em cada plataforma** (Google, Meta, TikTok). As credenciais desses apps ficam em
variáveis de ambiente na Vercel, só no servidor. Quando o dono clica em "Conectar com Google", por exemplo,
ele é levado ao Google, autoriza, e o Google devolve um token. A JUDITE guarda esse token **criptografado**.

Antes de começar, abra a JUDITE → **Conexões** → caixa **Configuração do administrador** (no fim da página).
Ela mostra:

- as **URLs de retorno** exatas para colar em cada plataforma;
- quais **variáveis ainda faltam** (só os nomes).

Deixe essa página aberta em uma aba: você vai copiar as URLs dela.

### Primeiro de tudo: `SITE_URL`

Na Vercel, crie a variável `SITE_URL` com o endereço definitivo do site, sem barra no fim.
Exemplo: `https://judite-pi.vercel.app`. As URLs de retorno são montadas a partir dela.

Onde: [vercel.com](https://vercel.com) → projeto **judite** → **Settings** → **Environment Variables**.

---

## a) Google Cloud (app OAuth do Google)

Serve para o Google Ads e para a Presença no Google (Perfil da Empresa e Search Console).

1. Abra [console.cloud.google.com](https://console.cloud.google.com) e entre com a conta Google da empresa.
2. No topo, clique no seletor de projetos → **Novo projeto** → nome `JUDITE` → **Criar**. Selecione o projeto criado.
3. **Ativar a Google Ads API:** abra [console.cloud.google.com/apis/library/googleads.googleapis.com](https://console.cloud.google.com/apis/library/googleads.googleapis.com) → **Ativar**.
4. **Tela de consentimento:** abra [console.cloud.google.com/apis/credentials/consent](https://console.cloud.google.com/apis/credentials/consent).
   - Tipo de usuário: **Externo**.
   - Nome do app: `JUDITE`. E-mail de suporte: o seu.
   - Em **Escopos** (ou "Acesso a dados"), adicione `https://www.googleapis.com/auth/adwords`.
     Se for usar a Presença no Google, adicione também `https://www.googleapis.com/auth/business.manage` e
     `https://www.googleapis.com/auth/webmasters.readonly`.
5. **Colocar em Produção (importante):** na mesma tela, em **Status de publicação**, clique em **Publicar app**.
   - Enquanto o app estiver em **Teste**, o Google **cancela a autorização a cada 7 dias** e a JUDITE mostra "Precisa reconectar".
   - Em Produção, a autorização não vence. O Google pode mostrar um aviso de "app não verificado" no login;
     clique em **Avançado** → **Acessar JUDITE**. Para tirar esse aviso é preciso pedir a verificação do app ao Google.
6. **Criar o cliente OAuth:** abra [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) →
   **Criar credenciais** → **ID do cliente OAuth** → tipo **Aplicativo da Web**.
   - Em **URIs de redirecionamento autorizados**, cole a URL do Google que aparece na caixa "Configuração do administrador".
     Ela termina em `/api/conexoes/google/callback`.
   - Para testar no seu computador, adicione também `http://localhost:3000/api/conexoes/google/callback`.
7. Clique em **Criar**. Copie o **ID do cliente** e a **Chave secreta**. Eles viram:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`

## b) Google Ads (developer token)

O developer token é o que deixa um app ler e mudar campanhas pela API. Ele é pedido uma vez, numa conta de administrador.

1. Crie uma **conta de administrador (MCC)**, se ainda não tiver: [ads.google.com/home/tools/manager-accounts](https://ads.google.com/home/tools/manager-accounts) → **Criar uma conta de administrador**.
2. Vincule a conta de anúncios à MCC: dentro da MCC, **Contas** → **+** → **Vincular conta existente** → informe o ID da conta de anúncios → aceite o convite na conta de anúncios.
3. Dentro da MCC, abra **Administrador** → **Central de API** (em algumas telas: Ferramentas → Configuração → Central de API).
4. Preencha o formulário e aceite os termos. O **developer token** aparece na hora, com **acesso de teste** (só enxerga contas de teste).
5. Na mesma tela, clique em **Solicitar acesso básico** e descreva o uso (ex.: "Painel interno para ler métricas e ajustar orçamentos das contas da própria empresa"). A aprovação leva de alguns dias a algumas semanas.
6. Variáveis:
   - `GOOGLE_ADS_DEVELOPER_TOKEN` = o developer token.
   - `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (opcional) = os 10 números da MCC, sem traços. Use se as contas de anúncios são acessadas por ela.

Enquanto o acesso básico não for aprovado, o login funciona, mas a lista de contas e a leitura de campanhas falham com a mensagem "developer token em acesso de teste".

## c) Meta for Developers (app da Meta)

1. Abra [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Criar app**.
2. Escolha o caso de uso de anúncios (**Criar e gerenciar anúncios com a API de Marketing**) e o tipo **Empresa**. Ligue o app ao seu portfólio empresarial.
3. No painel do app, adicione os produtos **Login do Facebook** (para empresas, se for oferecido) e **API de Marketing**.
4. Em **Login do Facebook** → **Configurações** → **URIs de redirecionamento do OAuth válidos**, cole a URL da Meta que aparece na
   caixa "Configuração do administrador". Ela termina em `/api/conexoes/meta/callback`. Salve.
5. Em **Configurações do app** → **Básico**: preencha a URL da política de privacidade e o domínio do app (o mesmo da `SITE_URL`).
   Copie o **ID do app** e a **Chave secreta do app** (clique em Mostrar). Eles viram:
   - `META_APP_ID`
   - `META_APP_SECRET`
6. **Usar sem revisão do app:** as permissões `ads_read`, `ads_management` e `business_management` em **acesso padrão** funcionam
   para quem tem função no app. Em **Funções do app** → **Funções** → **Adicionar pessoas**, adicione o seu perfil como **Administrador**
   (e, se precisar, outras pessoas como Desenvolvedor ou Testador). Cada pessoa aceita o convite em [developers.facebook.com/requests](https://developers.facebook.com/requests).
   - Assim você conecta as **suas** contas de anúncios sem pedir revisão.
   - Para pessoas que **não** têm função no app conectarem as contas delas, é preciso pedir **acesso avançado** (Revisão do app) e fazer a verificação da empresa.
7. Recomendado: em **Configurações do app** → **Avançado** → **Segurança**, ligue **Exigir chave secreta do app**. A JUDITE já envia a prova (`appsecret_proof`) em todas as chamadas.

O acesso da Meta dura cerca de **60 dias**. A JUDITE avisa 7 dias antes e mostra o botão **Reconectar**.
Se preferir um acesso que não vence, use o **token de usuário do sistema** em Conexões → Meta → Opções avançadas.

## d) TikTok for Business Developers (app do TikTok)

1. Abra [business-api.tiktok.com/portal](https://business-api.tiktok.com/portal) e entre com a conta do TikTok for Business. Cadastre-se como desenvolvedor, se pedir.
2. **My Apps** → **Create New**. Preencha nome (`JUDITE`) e descrição do uso.
3. Em **Advertiser redirect URL**, cole a URL do TikTok que aparece na caixa "Configuração do administrador".
   Ela termina em `/api/conexoes/tiktok/callback`.
4. Marque as permissões de **Ads Management** (ler e gerenciar campanhas) e **Reporting** (relatórios).
5. Envie para aprovação. O TikTok analisa o app antes de liberar; costuma levar alguns dias.
6. Depois de aprovado, copie o **App ID** e o **Secret**. Eles viram:
   - `TIKTOK_APP_ID`
   - `TIKTOK_APP_SECRET`

## e) Onde colar cada variável na Vercel

1. Abra [vercel.com](https://vercel.com) → projeto **judite** → **Settings** → **Environment Variables**.
2. Para cada linha da tabela: clique em **Add**, cole o **nome** exatamente como está, cole o **valor**, marque **Production** e **Preview**, e salve.
3. No fim, abra **Deployments** → nos três pontinhos do deploy mais recente → **Redeploy**. As variáveis só valem depois disso.

| Variável | De onde vem | Obrigatória |
|---|---|---|
| `SITE_URL` | Endereço definitivo do site, sem barra no fim | Recomendada |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud, passo a.7 | Para o Google |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud, passo a.7 | Para o Google |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads, passo b.4 | Para o Google Ads |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Google Ads, passo b.6 (10 números da MCC) | Opcional |
| `META_APP_ID` | Meta, passo c.5 | Para a Meta |
| `META_APP_SECRET` | Meta, passo c.5 | Para a Meta |
| `TIKTOK_APP_ID` | TikTok, passo d.6 | Para o TikTok |
| `TIKTOK_APP_SECRET` | TikTok, passo d.6 | Para o TikTok |

Nunca cole esses valores em chat, e-mail ou no código. Para rodar no seu computador, coloque as mesmas linhas no arquivo `.env.local`.

## Como conferir

1. Abra a JUDITE → **Conexões**. Na caixa "Configuração do administrador", cada plataforma configurada aparece com ✓.
2. Clique em **Conectar com Google** → faça login → escolha a conta de anúncios na lista.
3. Repita com **Conectar com Facebook** e **Conectar com TikTok**.
4. Abra **Tráfego** → **Sincronizar dados**.

## Perguntas comuns

- **"Precisa reconectar" no Google depois de uma semana:** o app do Google Cloud ainda está em Teste. Faça o passo a.5.
- **Erro `redirect_uri_mismatch`:** a URL de retorno cadastrada na plataforma não é igual à da JUDITE. Copie de novo da caixa do administrador, sem espaço e sem barra no fim.
- **A lista de contas do Google veio vazia:** o e-mail que fez login não administra nenhuma conta de anúncios ativa, ou o developer token ainda está em acesso de teste.
- **Desconectar:** a JUDITE revoga o acesso no Google e na Meta e apaga os tokens. No Google, se o Google Ads e a Presença usam o mesmo e-mail, o acesso só é revogado quando as duas conexões forem desconectadas.
- **Workspace com app próprio (modo antigo):** continua funcionando. Os campos estão em "Opções avançadas" de cada cartão.
