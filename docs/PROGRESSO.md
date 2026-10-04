# Progresso do modo autônomo

Diário do Claude Code. Cada etapa concluída ganha uma entrada: data/hora, o que foi feito,
arquivos principais, decisões tomadas sozinho e o que o Jackson precisa testar.

## Entradas

### Etapa 1 — Diagnóstico da aba Site (04/10/2026, madrugada)

**O que descobri**
- O site www.guialencois.org carrega o rastreador certo (`<script defer src="https://judite-pi.vercel.app/j.js" data-chave="9665d30b…">`) e **não tem** cabeçalho de segurança (CSP) que bloqueie o script.
- O `j.js` publicado responde 200 com o tipo correto; a rota `/api/coleta` responde.
- Consultei o banco **só para leitura** (um `select` em `sites` e `site_eventos`): o site está cadastrado com a mesma chave e **já existem 8 eventos gravados**, o primeiro às 23h57 de 03/10 (horário de Brasília), todos de Barreirinhas (7 visualizações e 1 clique no WhatsApp).
- Conclusão: o "0 visitas" era de antes da publicação das 23h57 (a versão do `j.js` no ar tem exatamente esse horário). **A coleta está funcionando.** Não encontrei erro de CORS, de origem (aceita `guialencois.org` e `www.guialencois.org`) nem do proxy.

**O que mudei**
- `public/j.js`: modo de teste. Abrir `https://www.guialencois.org/?judite_teste=1` envia um evento marcado como teste e mostra uma faixa verde/vermelha no canto do site com o resultado e o motivo.
- `src/app/api/coleta/route.ts`: no modo de teste a rota responde o motivo (robô, chave errada, domínio errado, banco recusou). Fora do teste continua respondendo 204 sem explicar nada. Erro de gravação agora aparece nos logs da Vercel (antes sumia em silêncio). Cidade com codificação quebrada não derruba mais a coleta. `/index.html` passa a contar como `/`.
- Aba Site: indicador **"Última visita recebida"** e **"Último teste"**, sempre visíveis.
- Vitest instalado (`npx vitest run`), com os primeiros testes em `src/lib/site/resumo.test.ts`.

**Decisões tomadas sozinho**
- O teste é gravado como `tipo = evento` e `nome = judite_teste`, sem coluna nova: assim **não precisa de migração** e funciona já. Esses eventos ficam fora de todas as contas.
- Mantive o filtro de robôs como estava (não afrouxei).
- Para instalar o Vitest precisei subir `@types/node` de 20 para 22 (só tipos; não muda o site).
- Li o banco de produção apenas com `select`. Nada foi escrito nem aplicado.

**Como testar**
1. Abra `https://www.guialencois.org/?judite_teste=1` (depois que a prévia/produção estiver com este código). Deve aparecer a faixa verde "teste recebido".
2. Na JUDITE, aba Site: "Última visita recebida" e "Último teste" com data e hora.

### Etapa 2 — Saída do Windsor e provedor nativo da Meta (04/10/2026)

**O que mudei**
- Apaguei `src/lib/anuncios/windsor.ts`, a variável `WINDSOR_API_KEY` do `.env.example` e os textos sobre "provedor temporário".
- Novo `src/lib/anuncios/meta.ts` (Marketing API oficial, versão `v26.0`): métricas diárias por campanha e anúncio (`/act_…/insights`), estado e orçamento das campanhas (`/act_…/campaigns`), pausar/ativar e mudar orçamento diário (em centavos).
- `src/lib/anuncios/provedor.ts`: o provedor agora é escolhido **por workspace** (`provedorDoWorkspace`), lendo a conexão salva em Conexões. Sem conexão, devolve a mensagem "Conecte a Meta em Conexões…".
- Sincronização (`/api/trafego/sync`) e ações (`/api/trafego/acoes`) usam o provedor de cada plataforma. O status gravado depois de pausar/ativar agora segue o nome de cada plataforma (Meta usa `ACTIVE`, Google usa `ENABLED`).
- Telas Tráfego e Gerenciador mostram um aviso amarelo com as plataformas ainda não conectadas e um link para Conexões. O botão Sincronizar passa a mostrar o motivo quando uma plataforma falha.
- Testes em `src/lib/anuncios/meta.test.ts` (conversão de centavos, compra não contada em dobro).

**Decisões tomadas sozinho**
- Versão da API: testei sem credenciais quais versões respondem (`graph.facebook.com/vNN.0`); a mais nova hoje é a **v26.0**. Fica numa constante só (`META_VERSAO` em `src/lib/conexoes/config.ts`).
- "Compras" usa o primeiro tipo encontrado entre pixel → purchase → omni_purchase, porque a Meta repete a mesma compra em vários tipos.
- "Cliques" usa cliques no link (o que leva ao site), não o total de cliques.
- Campanha da Meta sem orçamento próprio (orçamento nos conjuntos) aparece com orçamento "definir"; tentar mudar pede confirmação e a Meta pode recusar. O erro fica no histórico.
- Não chamei nenhuma API com token real. O código só foi exercitado pelos testes, com dados de exemplo.
- A variável `WINDSOR_API_KEY` pode ser apagada da Vercel e do `.env.local` (não é mais lida).

**Como testar**
1. Sem conexão: abra Tráfego. Deve aparecer o aviso "Meta Ads: conecte a Meta em Conexões…".
2. Conecte a Meta em Conexões (token do usuário do sistema + ID da conta) e clique em "Sincronizar dados" no Tráfego.
3. No Gerenciador, as campanhas da Meta devem aparecer com status e orçamento.

### Etapa 3 — Google Ads nativo (04/10/2026)

**O que mudei**
- Novo `src/lib/anuncios/google.ts` (Google Ads API, REST, versão `v26`): renova o access token com o refresh token salvo, lê métricas diárias por campanha e o estado/orçamento das campanhas com consultas GAQL (`googleAds:search`), pausa/ativa (`campaigns:mutate`) e muda o orçamento diário em micros (`campaignBudgets:mutate`). Envia os cabeçalhos `developer-token` e, quando há conta de administrador, `login-customer-id`.
- `provedorDoWorkspace` agora atende o Google: se faltar alguma parte da conexão, a mensagem diz exatamente qual (app OAuth, autorização, developer token ou ID do cliente).
- Página Conexões: aviso de que o Google Ads depende da aprovação do developer token.
- Testes em `src/lib/anuncios/google.test.ts`.

**Decisões tomadas sozinho**
- Versão: testei sem credenciais; v22 a v26 respondem. Usei a **v26** (constante `GOOGLE_ADS_VERSAO`).
- A leitura é **por campanha**, não por anúncio, porque Performance Max e campanhas inteligentes não expõem anúncio. No ranking de anúncios do Dashboard, o Google aparece pelo nome da campanha (o painel já previa isso).
- Campanha com **orçamento compartilhado** não é alterada pela JUDITE (mudaria outras campanhas junto). A tela mostra o motivo.
- Erro `DEVELOPER_TOKEN_NOT_APPROVED` vira a frase: "O developer token do Google Ads ainda está em acesso de teste…".
- Não chamei a API do Google com credenciais reais.

**Como testar**
1. Com o Google conectado mas o token ainda em teste: Tráfego → Sincronizar dados. Deve aparecer a mensagem sobre o acesso de teste, sem quebrar a tela.
2. Depois da aprovação: sincronizar e conferir as campanhas no Gerenciador.

### Etapa 4 — TikTok Ads (04/10/2026)

**O que mudei**
- Novo `src/lib/anuncios/tiktok.ts` (TikTok Marketing API v1.3): relatório diário por anúncio, campanhas (status e orçamento diário), pausar/ativar e mudar orçamento.
- Conexão em Conexões: passo a passo, formulário do app (App ID e Secret, criptografados), botão "Autorizar no TikTok" (OAuth com `state` em cookie protegido, rotas `/api/conexoes/tiktok/iniciar` e `/callback`) e escolha da conta de anúncios, testada no TikTok antes de salvar.
- `tiktok` virou a terceira plataforma em todo o painel: tipos, aviso de conexões, filtro por plataforma no Dashboard (novo), nome da plataforma em cada linha do Gerenciador e nas ações.
- Migração `20261004010000_etapa4_tiktok.sql` (**não aplicada**): amplia os `check` de `trafego_contas`, `trafego_metricas_dia`, `trafego_campanhas` e `conexoes` para aceitar `tiktok`.

**Decisões tomadas sozinho**
- Pedi ao relatório do TikTok só as métricas de que tenho certeza (gasto, impressões, cliques, conversões, nomes). **Não leio o valor das compras do TikTok** (receita fica 0) para não arriscar um nome de campo errado, que faria o pedido inteiro falhar. O faturamento real vem das vendas registradas na página Comercial (Etapa 5). Está em PENDENTE para conferir com a conta real.
- Períodos longos são quebrados em janelas de 30 dias (limite do relatório diário do TikTok).
- Campanha do TikTok com verba total (não diária) aparece sem orçamento diário, para os freios não compararem coisas diferentes.
- Antes de aplicar a migração, salvar a conexão do TikTok falha com uma mensagem que explica isso. O resto do painel não é afetado.
- Não chamei a API do TikTok com credenciais reais.

**Como testar**
1. Aplicar a migração da Etapa 4 (ver PENDENTE).
2. Conexões → TikTok Ads: seguir o passo a passo. Sem app aprovado pelo TikTok, só dá para ver a tela e salvar as credenciais.
3. Dashboard de Tráfego: os botões "Todas as plataformas / Google Ads / Meta Ads / TikTok Ads" filtram os números.

### Etapa 5 — Comercial e Budget & ROI (04/10/2026)

**O que mudei**
- Nova página **Comercial** (`/painel/[workspaceId]/comercial`, link no menu): cartões de faturamento, vendas, ticket médio, gasto em anúncios, **ROAS real** (vendas registradas ÷ gasto) e **CAC**; barra do orçamento mensal; **metas do mês com anéis de progresso**; formulário para **registrar venda do WhatsApp** (data, produto, pessoas, valor, origem, campanha, observação); desempenho por produto e por origem; lista de vendas do mês (dono/admin podem apagar); navegação entre meses.
- Novo limite **Orçamento mensal máximo** (padrão R$ 2.000) na tela Limites da IA.
- **Freio mensal** em `src/lib/trafego/limites.ts`: projeta o gasto até o fim do mês (já gasto + orçamentos diários das campanhas ligadas × dias restantes). Aumento de verba ou **ativação de campanha** que passe do teto vira `aguardando_aprovacao`. Reduzir verba e pausar nunca são barrados.
- Padrão de variação por ajuste caiu de 50% para **10%** no código e na migração.
- A lógica de agir numa campanha saiu da rota e foi para `src/lib/trafego/executar.ts` (`executarAcao`): é o único caminho para mudar campanha, reutilizado depois pelo Diretor e pela autonomia. A rota `/api/trafego/acoes` continua igual por fora.
- Migração `20261004020000_etapa5_orcamento_mensal.sql` (**não aplicada**).
- Testes: `limites.test.ts` (freios diário, percentual e mensal, datas em horário de Brasília) e `comercial/contas.test.ts`.

**Decisões tomadas sozinho**
- A página Comercial usa as tabelas `trafego_vendas` e `trafego_metas`, que **já existiam** no banco, então funciona antes de qualquer migração. Só o campo "Orçamento mensal máximo" depende da migração; sem ela, a tela avisa e os freios usam o padrão de R$ 2.000.
- Na migração, só troco 50% → 10% para quem ainda está no padrão antigo (valor exatamente 50). Quem já escolheu outro número não é alterado. **Atenção, Jackson:** depois de aplicar, aumentos acima de 10% de uma vez vão pedir confirmação.
- "Gasto do mês" é o que a sincronização já gravou (até ontem). O mês vira no horário de Brasília.
- Data de venda no futuro é recusada (quase sempre é erro de digitação).
- Meta com campo vazio ou zero = sem meta naquela métrica.
- Em investimento e CAC, o anel trata o alvo como **limite** (ficar abaixo é bom).

**Como testar**
1. Comercial → registrar uma venda (ex.: produto, 2 pessoas, um valor). Os cartões e as tabelas mudam na hora.
2. "Definir metas do mês" → colocar uma meta de faturamento → o anel aparece com o percentual.
3. Com campanhas sincronizadas: no Gerenciador, tentar um aumento que faça o mês passar do teto → aparece a pergunta de confirmação e o histórico registra `aguardando_aprovacao`.
