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

### Etapa 6 — Diretor v1: análise e recomendações (04/10/2026)

**O que mudei**
- Serviço `src/lib/diretor/`:
  - `resumo.ts` monta um resumo só com dados do banco (tráfego dos últimos 14 dias e dos 14 anteriores, campanhas, site dos últimos 7 dias, vendas e metas do mês, limites). O que falta vira um aviso em texto, não um número.
  - `claude.ts` chama a **Claude API** pelo SDK oficial (`@anthropic-ai/sdk`), modelo `claude-opus-5-5`, pedindo a resposta em JSON no formato de um schema zod (saída estruturada).
  - `regras.ts` confere de novo cada recomendação: campanha tem de existir nos dados, mínimo de **7 dias** de dados (período de aprendizado), mínimo de **100 cliques**, e **5 conversões** para aumentar verba. O que não passa é descartado e listado na tela com o motivo.
  - `gerar.ts` junta tudo e grava relatório + recomendações (status `proposta`).
- Página **Diretor** (link no menu): relatório do dia, pontos de atenção, recomendações com **Aprovar / Recusar**, botão "Gerar relatório agora" (dono/admin, no máximo 1 a cada 10 minutos).
- Cron diário `/api/diretor/cron` às 09h30 UTC (06h30 de Brasília), logo depois da sincronização. Protegido pelo mesmo `CRON_SECRET`.
- Migração `20261004030000_etapa6_diretor.sql` (**não aplicada**): tabelas `diretor_relatorios` e `diretor_recomendacoes`, com RLS (leitura para membros, escrita só pelo servidor).
- Variável nova `ANTHROPIC_API_KEY` no `.env.example`.
- Testes em `src/lib/diretor/regras.test.ts`.

**Decisões tomadas sozinho**
- **Aprovar não executa nada nesta etapa** (como pede a Fase 5 da visão: "sem executar"). A execução com aprovação entra nas Etapas 9 e 10.
- Sem `ANTHROPIC_API_KEY`, a página explica o passo a passo para criar a chave; sem a migração, avisa que falta aplicar. Nada quebra.
- O resumo enviado à IA só tem números agregados. **Nenhum dado pessoal** (nem observação de venda) é enviado.
- Não usei o recurso de "fallback" de modelo da API (é beta e eu não consegui confirmar que funciona junto com a saída estruturada). Se a IA recusar ou a resposta vier cortada, o relatório é registrado como erro com a explicação.
- **Não cheguei a chamar a Claude API de verdade**: não posso ler o `.env.local` e não há chave no ambiente. O formato do pedido segue a documentação do SDK instalado (0.131.0) e compila; o primeiro teste real fica para o Jackson (está no roteiro).
- Custo: cada relatório é uma chamada com poucos milhares de tokens. No modelo escolhido, a ordem de grandeza é de centavos de dólar por relatório; o valor exato aparece no console da Anthropic.
- O plano Hobby da Vercel aceita cron 1x/dia; agora são dois crons (sincronização e Diretor). Se a Vercel recusar o segundo, a alternativa está em PENDENTE.

**Como testar**
1. Sem a chave: abrir Diretor → aparece a explicação do que falta.
2. Aplicar a migração da Etapa 6, cadastrar `ANTHROPIC_API_KEY` na Vercel e clicar em "Gerar relatório agora".
3. Conferir se os números citados batem com Tráfego, Site e Comercial. Aprovar uma recomendação e recusar outra.

### Etapa 7 — Perfil da Empresa no Google e Search Console (04/10/2026)

**O que mudei**
- Conexões: nova seção **Presença no Google**, que reaproveita o app OAuth do workspace (o mesmo do Google Ads) e pede os escopos `business.manage` e `webmasters.readonly`. A autorização fica numa conexão separada (`google_presenca`), com o refresh token criptografado. Passo a passo e **aviso claro de que a Business Profile API exige pedido de acesso ao Google**.
- `src/lib/presenca/google.ts`: leitura do perfil (informações), avaliações, desempenho (visualizações, cliques para o site, ligações, rotas) e do Search Console (consultas, páginas, cliques, impressões, posição). Escrita: responder avaliação e publicar post.
- Página **Presença no Google** (link no menu): o dono escolhe qual perfil e qual propriedade do Search Console são do workspace; cartões e tabelas; rascunho de resposta/post; **fila de aprovações**.
- **Nada é publicado no Google sem aprovação**: dono ou admin escrevem o rascunho (`aguardando_aprovacao`); **só o dono** clica em "Aprovar e publicar".
- O Diretor passa a receber um bloco `presenca_google` no resumo e a sugerir melhorias de perfil (`perfil_google`) e de SEO/AEO (`seo`).
- Migração `20261004040000_etapa7_presenca_google.sql` (**não aplicada**): conexão `google_presenca` e tabela `presenca_acoes` com RLS.
- Testes em `src/lib/presenca/google.test.ts`.

**Decisões tomadas sozinho**
- Cada parte da tela falha sozinha: se o Google ainda não liberou o perfil, o Search Console continua aparecendo, e cada falha mostra o motivo em português (API não ativada, cota zero = falta o pedido de acesso, autorização vencida).
- A leitura é **ao vivo** (não guardo cópia das avaliações no banco), para não armazenar nome de cliente.
- Para o Diretor, as avaliações vão **sem o nome de quem escreveu** (só estrelas e o texto, que é público no Google, cortado em 300 caracteres). Isso ajusta o que escrevi na Etapa 6: o resumo continua sem nomes nem contatos.
- O dono só pode escolher perfil e site que a conta autorizada realmente administra (conferido no Google na hora de salvar).
- A IA **não** escreve respostas nem posts nesta etapa: o texto é de uma pessoa. Geração de texto fica no Creative Studio (Etapa 8).
- Usei os endereços das APIs que conheço da documentação oficial (Account Management v1, Business Information v1, Performance v1, My Business v4 para avaliações e posts, Search Console v3). **Não consegui testar com conta real**: está no roteiro e em PENDENTE.

**Como testar**
1. Aplicar a migração da Etapa 7. Em Conexões → Presença no Google → Autorizar (precisa da Parte B do Google feita).
2. Presença no Google → escolher a propriedade do Search Console → ver consultas e páginas.
3. Se a Business Profile API já estiver liberada: escolher o perfil, escrever uma resposta a uma avaliação, conferir que ela fica "aguardando aprovação" e só publica depois do clique do dono.

### Etapa 8 — Creative Studio e Learning Engine (04/10/2026)

**O que mudei**
- Página **Creative Studio** (link no menu), com cinco partes: Produtos, Pedir variações, Criativos, Experimentos (testes A/B) e Aprendizados.
- **Produtos** são a única fonte de fatos para a IA (nome, descrição, preço opcional, fatos importantes, público).
- `src/lib/criativos/gerar.ts`: pede à Claude API variações com título, descrição, chamada (CTA) e texto em **AIDA** e **PAS**, respeitando o tamanho de cada plataforma. Depois da IA o código confere: variação que cita **qualquer número que não está no cadastro** (preço, desconto, duração, nota) é barrada, assim como a que passa do tamanho.
- Variações aprovadas na conferência são salvas como rascunho; a pessoa clica em "salvar" ou "descartar".
- **Experimentos**: registra o teste (hipótese, criativo A e B, métrica, início) e, ao concluir, os resultados digitados por uma pessoa, o vencedor e a conclusão, que vira um **aprendizado**.
- O **Diretor** agora recebe os aprendizados e os experimentos recentes no resumo e é instruído a não repetir o que já foi refutado.
- Migração `20261004050000_etapa8_creative_learning.sql` (**não aplicada**): tabelas `produtos`, `criativos`, `hipoteses`, `experimentos`, `aprendizados`, com RLS (membros leem; dono/admin escrevem).
- Testes em `src/lib/criativos/gerar.test.ts`.

**Decisões tomadas sozinho**
- Criei a tabela `produtos` (o plano não citava), porque "usar só dados cadastrados" precisa de um cadastro. A página Comercial continua aceitando o nome do produto digitado à mão; ligar as duas fica como melhoria futura.
- A conferência de números é rígida de propósito: prefiro barrar uma variação boa a deixar passar um preço inventado. A tela informa quantas foram barradas.
- Os resultados dos testes A/B são **digitados por uma pessoa** a partir da plataforma. A JUDITE não calcula o vencedor sozinha nesta etapa (as métricas por anúncio ainda não distinguem variações de um mesmo teste).
- "Desativar" produto não apaga nada (o histórico de criativos e testes continua).
- Não cheguei a chamar a Claude API de verdade (mesmo motivo da Etapa 6).

**Como testar**
1. Aplicar a migração da Etapa 8. Creative Studio → cadastrar um produto com preço e fatos.
2. Com `ANTHROPIC_API_KEY`: "Gerar variações" → conferir que nenhum texto traz preço ou número que você não cadastrou.
3. Registrar um experimento com dois criativos, concluir com resultados e ver a conclusão aparecer em Aprendizados.

### Etapa 9 — Campaign Manager (04/10/2026)

**O que mudei**
- Página **Campanhas** (link no menu): "Pedir um rascunho ao Diretor" (IA) ou "Montar um rascunho à mão"; lista de rascunhos com os avisos dos freios; botões do dono: **Aprovar**, **Recusar** e, depois, **Aprovar ativação**.
- Fluxo: rascunho (`aguardando_aprovacao`) → o **dono** aprova → campanha criada **PAUSADA** (`publicada_pausada`) → ativar é **outra aprovação** do dono (`ativa`).
- `src/lib/campanhas/`: `rascunho.ts` (schema e conferência pelos freios: teto diário, orçamento do mês, criativos válidos), `diretor.ts` (a IA monta o rascunho com os dados reais, o produto e os criativos salvos; tudo passa pelo mesmo schema), `publicar.ts` (publicação pausada e ativação).
- Provedores: novo método opcional `criarCampanhaPausada` na **Meta** (`status=PAUSED`) e no **TikTok** (`operation_status=DISABLE`).
- **Tudo registrado em `trafego_acoes`**: o rascunho (`criar_campanha_pausada`, `aguardando_aprovacao`), a criação (`aplicada` ou `erro`) e a ativação.
- Migração `20261004060000_etapa9_campaign_manager.sql` (**não aplicada**): tabela `campanha_rascunhos` com RLS.
- Variável nova `JUDITE_PUBLICACAO_REAL`.
- Testes em `src/lib/campanhas/rascunho.test.ts` (inclui "a campanha é sempre criada pausada").

**Decisões tomadas sozinho**
- **Modo simulado é o padrão.** Sem `JUDITE_PUBLICACAO_REAL=1` no servidor, aprovar e ativar acontecem só dentro da JUDITE (marcado como SIMULADA na tela e no histórico) e nenhuma API de plataforma é chamada. É assim que o fluxo deve ser testado amanhã.
- **Só o dono** aprova, recusa e ativa (admin monta o rascunho).
- No modo real, a JUDITE cria só a "casca" da campanha (nome, objetivo, orçamento), pausada. **Conjunto de anúncios (público) e anúncios (criativos) são finalizados na plataforma**, seguindo o rascunho. Criar conjuntos e anúncios pela API exige página, pixel e mídia, e eu não quis inventar esses campos.
- **Google Ads não tem criação por aqui** nesta versão: a API exige vários campos obrigatórios que mudam entre versões e não pude confirmar. A tela diz isso e o rascunho serve de roteiro.
- No modo real, a campanha criada entra no Gerenciador como pausada, e a ativação passa pelo mesmo `executarAcao` (freios do mês + histórico) das outras campanhas.
- Não chamei nenhuma API de plataforma. O modo real **não foi testado**.

**Como testar (modo simulado)**
1. Aplicar as migrações das Etapas 8 e 9.
2. Campanhas → "Montar um rascunho à mão" → salvar. Deve aparecer "aguardando aprovação" e, se o orçamento passar dos limites, os avisos em amarelo.
3. Como dono: "Aprovar (simulado)" → vira "criada e pausada · SIMULADA". Depois "Aprovar ativação (simulado)" → "ativa · SIMULADA".
4. Gerenciador → Histórico de ações: as três linhas aparecem (rascunho, criação e ativação), marcadas como SIMULAÇÃO.

### Etapa 10 — Autonomia supervisionada (04/10/2026)

**O que mudei**
- Chave **"Autonomia da JUDITE"** por workspace, na página Diretor. **Desligada por padrão** (sem linha no banco = desligada). Só o **dono** liga, marcando uma caixa de "li as regras".
- Botão vermelho **"Parar tudo"** (dono ou admin): desliga na hora. A rodada confere a chave de novo antes de cada ação, então parar vale mesmo no meio de uma execução.
- `src/lib/diretor/autonomia.ts`, com regras **determinísticas (sem IA)**:
  - **pausar** campanha ativa com R$ 100 ou mais de gasto em 14 dias e zero conversões, depois de 7 dias de dados e 100 cliques;
  - **reduzir 10%** a verba de campanha com custo por conversão 2x acima da média da plataforma;
  - **aumentar até 10%** a verba de campanha com custo por conversão até 70% da média e pelo menos 5 conversões.
- Toda ação sai por `executarAcao` com origem `automacao`: os freios de `limites.ts` valem do mesmo jeito, e o que passa de qualquer limite (teto diário, % por ajuste, orçamento do mês) **não é aplicado**, fica `aguardando_aprovacao`.
- Roda no cron diário, depois do relatório. Funciona mesmo sem a chave da IA.
- **Visível no histórico**: a página Diretor lista as últimas ações da automação, e o Histórico de ações do Gerenciador ganhou a coluna "Quem" (pessoa ou JUDITE).
- Aprovar uma recomendação de verba do Diretor agora **aplica** a mudança (pelo mesmo `executarAcao`, com o clique humano valendo como confirmação) e a recomendação vira `executada`.
- Migração `20261004070000_etapa10_autonomia.sql` (**não aplicada**).
- Testes em `src/lib/diretor/autonomia.test.ts` (12 casos).

**Decisões tomadas sozinho**
- **A autonomia não pausa por "zero conversões" quando a plataforma não está medindo conversão nenhuma.** No Guia Lençóis a venda acontece no WhatsApp; se o pixel não registra compra, todas as campanhas teriam "zero conversões" e seriam pausadas por engano. Só pauso quando alguma outra campanha da mesma plataforma converteu (sinal de que a medição funciona).
- No máximo 3 ações por dia por workspace, e nunca na mesma campanha duas vezes em 7 dias (período de aprendizado).
- A autonomia **nunca** cria campanha, **nunca** ativa campanha e **nunca** publica no Perfil da Empresa. Só pausa, reduz e aumenta dentro dos limites.
- A IA não decide ações automáticas: ela só recomenda. As ações automáticas vêm de regras fixas e testadas.
- Não testei com plataforma real. A autonomia só age se houver conexão, campanhas sincronizadas e a chave ligada.

**Como testar**
1. Aplicar a migração da Etapa 10. Diretor → seção "Autonomia da JUDITE": deve aparecer **Desligada**.
2. Como dono: marcar a caixa e "Ligar autonomia" → fica verde e aparece o botão "Parar tudo". Clicar em "Parar tudo" → volta a desligada.
3. **Recomendo deixar desligada** até as plataformas estarem conectadas e você ter acompanhado alguns relatórios.

## Resumo final do modo autônomo (04/10/2026)

**Situação:** as 10 etapas do plano foram implementadas, na ordem, na branch `desenvolvimento`
(um commit por etapa, todos enviados ao GitHub). `npm run lint` e `npm run build` passam; `npx vitest run`
passa com 70 testes em 11 arquivos. Nada foi para a `main`, nenhuma migração foi aplicada e nenhuma API de
plataforma foi chamada com credenciais.

| Etapa | Entrega | Critério "pronto quando" |
|---|---|---|
| 1 | Diagnóstico da aba Site, modo de teste e "última visita" | Cumprido: a coleta já funciona (causa documentada). |
| 2 | Windsor removido; provedor nativo da Meta por workspace | Cumprido no código; **não testado com conta real**. |
| 3 | Google Ads nativo | Cumprido no código; depende do developer token; não testado com conta real. |
| 4 | TikTok Ads (conexão + provedor + terceira plataforma) | Cumprido no código; precisa da migração 1 e do app aprovado. |
| 5 | Comercial, metas, ROAS real, CAC e freio mensal | Cumprido; a página funciona sem migração, o limite mensal precisa da migração 2. |
| 6 | Diretor v1 | Cumprido no código; **a chamada real à Claude API não foi testada** (sem chave). |
| 7 | Presença no Google | Cumprido no código; não testado com conta real. |
| 8 | Creative Studio e Learning Engine | Cumprido no código; geração real não testada (sem chave). |
| 9 | Campaign Manager | Cumprido em modo simulado (o que o plano pedia). Modo real não testado. |
| 10 | Autonomia supervisionada | Cumprido: regras cobertas por testes e visíveis no histórico. |

**O que é mais importante saber**
1. O maior risco é o do item "não testado com conta real": as integrações foram escritas com cuidado, mas só o
   primeiro uso com credenciais vai confirmar cada campo. Os erros das plataformas aparecem em português na tela
   e no histórico, o que deve facilitar os ajustes.
2. Tudo o que mexe em dinheiro passa por um único caminho (`src/lib/trafego/executar.ts`) e pelos freios de
   `src/lib/trafego/limites.ts`. A automação nunca confirma sozinha acima de um limite.
3. Padrões seguros escolhidos: autonomia desligada, publicação de campanha em modo simulado, publicação no Perfil
   da Empresa só com aprovação do dono, variação por ajuste em 10%.
4. Li o banco de produção **só com `select`** duas vezes: para o diagnóstico da aba Site e para conferir os nomes
   das restrições que as migrações alteram.

O que falta fazer (migrações, variáveis, liberações e o roteiro de testes) está em `docs/PENDENTE.md`.

## IA pelo Google Gemini (04/10/2026)

**O que mudou**
- Novo módulo `src/lib/ia/` (substitui `src/lib/diretor/claude.ts`): `index.ts` exporta `pedirJson`, `iaConfigurada`,
  `ErroIA` e `RespostaIA` com a mesma assinatura de antes. Todos os usos (Diretor, Creative Studio, Campaign Manager,
  cron e páginas) passaram a importar de `@/lib/ia`.
- `provedor.ts`: a variável `IA_PROVEDOR` (`gemini` ou `anthropic`) escolhe o provedor. Vazia ou com valor
  desconhecido: Gemini se `GEMINI_API_KEY` existir, senão Anthropic.
- `gemini.ts`: API REST oficial (`POST .../v1beta/models/gemini-3.8-flash:generateContent`) com `fetch`, sem SDK novo.
  A chave vai no cabeçalho `x-goog-api-key`. A saída é pedida com `responseMimeType: application/json` +
  `responseJsonSchema` (JSON Schema gerado por `z.toJSONSchema`) e validada de novo com o zod.
- `anthropic.ts`: o código que já existia, agora com o modelo `claude-sonnet-5-5` (mais barato que o Opus).
- Telas: as mensagens "Falta a chave da IA" citam a variável do provedor escolhido; o passo a passo da página
  Diretor mostra o caminho do Gemini (ou o da Anthropic, se `IA_PROVEDOR=anthropic`).

**Decisões**
- Documentação consultada em ai.google.dev (modelos, preços, structured output, referência do `generateContent`):
  `gemini-3.8-flash` é o Flash estável mais recente e tem cota grátis.
- Sem chave nenhuma e sem `IA_PROVEDOR`, a regra pedida escolhe "anthropic", mas as telas orientam a criar a
  `GEMINI_API_KEY`, que é o caminho grátis.
- Qualquer `finishReason` diferente de `STOP`/`MAX_TOKENS` é tratado como bloqueio de segurança.
- A mensagem de erro 400 do Google é mostrada cortada em 200 caracteres e com a chave mascarada, por garantia.

**Limitação:** a chamada real ao Gemini não foi testada (sem chave no ambiente). Os testes usam `fetch` simulado.

**Como testar:** cadastrar `GEMINI_API_KEY` na Vercel → Redeploy → Diretor → "Gerar relatório agora"; depois
Creative Studio → "Gerar variações" e Campanhas → "Pedir rascunho".
