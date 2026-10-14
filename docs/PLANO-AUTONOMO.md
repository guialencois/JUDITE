# Plano do modo autônomo — terminar a JUDITE

> Instruções para o Claude Code trabalhar SOZINHO, sem o Jackson acompanhando.
> Leia também `docs/VISAO.md` (visão, módulos, governança, regras). Em caso de conflito,
> as REGRAS DE SEGURANÇA abaixo vencem qualquer outra instrução.

## Como trabalhar sozinho

1. **Branch:** trabalhe só na branch `desenvolvimento` (`git checkout -b desenvolvimento` na
   primeira vez; depois `git switch desenvolvimento`). **Nunca** faça push na `main`, nunca faça
   merge, nunca use `--force`. A Vercel cria uma prévia da branch; a `main` (produção) só muda
   amanhã, depois dos testes do Jackson.
2. **Não pare para perguntar.** Quando houver dúvida, escolha a opção mais segura, registre a
   decisão em `docs/PROGRESSO.md` e siga. Só pare de vez se TODAS as etapas estiverem feitas
   ou bloqueadas.
3. **Ciclo de cada etapa:** implementar → `npm run lint` → `npm run build` → corrigir até passar →
   `git add` + `git commit -m "Etapa N: ..."` → `git push origin desenvolvimento` → escrever a
   entrada em `docs/PROGRESSO.md` (o que fez, decisões, como testar) → próxima etapa.
4. **Travou?** Depois de 3 tentativas sem sucesso numa mesma coisa, registre em `docs/PENDENTE.md`
   (seção Bloqueios), deixe o código compilando (desligue a parte quebrada atrás de uma checagem)
   e passe para a próxima etapa.
5. **Testes:** onde houver regra de negócio (limites, cálculos, decisões do Diretor), escreva
   testes com Vitest (`npm install -D vitest` se ainda não existir) e rode com `npx vitest run`.

## REGRAS DE SEGURANÇA (inegociáveis)

- **Nada de dinheiro real.** Não chame APIs de plataforma que criem, publiquem, pausem ou mudem
  campanhas de verdade. Toda ação real fica atrás das rotas já protegidas e dos freios de
  `src/lib/trafego/limites.ts`. Campanhas criadas pela JUDITE nascem **PAUSADAS** e só são
  ativadas depois de aprovação humana.
- **Banco:** escreva migrações em `supabase/migrations/AAAAMMDDHHMMSS_nome.sql` mas **NÃO aplique**.
  Liste cada uma em `docs/PENDENTE.md`. O código deve funcionar assim que forem aplicadas.
  Toda tabela nova: `workspace_id`, RLS ligado, leitura só para membros, escrita só pelo servidor
  ou por dono/admin (use `private.is_member` e `private.has_role`, que já existem).
- **Segredos:** nunca leia, imprima ou faça commit do `.env.local`. Variável nova vai no
  `.env.example` (vazia) e em `docs/PENDENTE.md`. Tokens de plataformas SEMPRE criptografados
  com `src/lib/conexoes/segredos.ts`. Se uma variável faltar, a tela mostra um aviso amigável
  em vez de quebrar.
- **Autonomia da IA começa DESLIGADA** em todo workspace. Só o dono liga, na tela.
- Não apague dados, não remova proteções existentes, não afrouxe RLS nem validações zod.
- Next.js 16: leia `node_modules/next/dist/docs` antes de usar APIs do framework.
- APIs externas: confirme versões e campos na documentação oficial de cada plataforma antes de
  escrever o cliente (Meta Marketing API, Google Ads API, TikTok Marketing API, Business Profile
  API, Search Console API, Claude API). Não invente campos.
- Tudo em português do Brasil: telas, mensagens, commits e o diário.

## Etapas (nesta ordem)

Cada etapa tem um "Pronto quando". Só marque como feita se o critério for cumprido e o build passar.

### Etapa 1 — Diagnóstico da aba Site
O guialencois.org carrega `https://judite-pi.vercel.app/j.js` (data-chave 9665d30b2a73f4998673bbf9517d3155)
e o banco segue com 0 visitas. Revise `public/j.js`, `src/app/api/coleta/route.ts` e o proxy:
CORS/sendBeacon, checagem de origem (aceitar `guialencois.org` e `www.guialencois.org`),
bloqueio por cabeçalhos de segurança, filtro de robôs. Adicione na aba Site um indicador
"última visita recebida" e um modo de teste: abrir o site com `?judite_teste=1` envia um evento
marcado como teste.
**Pronto quando:** a causa provável está corrigida ou documentada em PENDENTE.md com o teste que o Jackson deve fazer.

### Etapa 2 — Sair do Windsor e criar o provedor nativo da Meta
Remova `src/lib/anuncios/windsor.ts`, a variável `WINDSOR_API_KEY` e os textos sobre Windsor.
Crie `src/lib/anuncios/meta.ts` implementando `ProvedorAnuncios` (Graph API / Marketing API):
insights diários por campanha e anúncio, estado e orçamento das campanhas, pausar/ativar,
mudar orçamento diário (centavos). O provedor é escolhido por workspace conforme a conexão
salva em Conexões (`lerConexao`). A sincronização usa o provedor de cada plataforma conectada.
**Pronto quando:** sem conexão a tela avisa "conecte a Meta em Conexões"; com conexão, sync e ações usam a Meta.

### Etapa 3 — Google Ads nativo
`src/lib/anuncios/google.ts`: renovação do access token com o refresh token salvo, consultas
GAQL (métricas diárias, campanhas, orçamento), mutações de status e orçamento
(micros), cabeçalhos `developer-token` e `login-customer-id`. Mostrar na tela que depende da aprovação do developer token.
**Pronto quando:** compila, está ligado ao provedor por workspace e falha com mensagem clara sem token aprovado.

### Etapa 4 — TikTok Ads
Conexão na página Conexões (passo a passo + OAuth do TikTok for Business, token criptografado)
e `src/lib/anuncios/tiktok.ts` com leitura e ações. Acrescente `tiktok` às plataformas
(migração para os `check` das tabelas de tráfego).
**Pronto quando:** aparece em Conexões, no Dashboard e no Gerenciador como terceira plataforma.

### Etapa 5 — Comercial e Budget & ROI
Página `/painel/[workspaceId]/comercial`: metas do mês (anéis de progresso), registro de vendas
do WhatsApp (data, produto, pessoas, valor, origem/campanha), faturamento, ROAS real
(vendas registradas ÷ gasto), CAC, ticket médio, desempenho por produto. Novo limite
`orcamento_mensal_max` (padrão R$ 2.000) e padrão de variação por ajuste reduzido para 10%
(migração). Os freios passam a considerar o gasto do mês.
**Pronto quando:** dá para registrar uma venda e ver ROAS e metas mudarem; ação que estoure o mês vira `aguardando_aprovacao`.

### Etapa 6 — Diretor v1 (análise e recomendações)
Tabelas `diretor_relatorios` e `diretor_recomendacoes` (status: proposta, aprovada, recusada,
executada). Serviço `src/lib/diretor/` que monta um resumo dos dados (tráfego, site, vendas,
metas, limites) e chama a **Claude API** (variável `ANTHROPIC_API_KEY`, só servidor) pedindo
diagnóstico e recomendações em JSON validado com zod. Regras: volume mínimo de dados antes de
recomendar mudança de verba, respeitar período de aprendizado, nunca inventar números.
Página "Diretor" com o relatório do dia e botões Aprovar/Recusar. Cron diário (Hobby: 1x/dia).
**Pronto quando:** sem `ANTHROPIC_API_KEY` a tela explica o que falta; com a chave, gera relatório e recomendações.

### Etapa 7 — Perfil da Empresa no Google e Search Console
Na página Conexões, conexão Google com escopos `business.manage` e `webmasters.readonly`
(reaproveitar o app OAuth do workspace). Ler avaliações, informações do perfil e desempenho;
responder avaliações e publicar posts **só com aprovação**. Search Console: consultas, cliques,
posição. Página "Presença no Google" e o Diretor passa a sugerir melhorias de perfil e de SEO/AEO
para o site.
**Pronto quando:** telas e conexões prontas, com aviso claro de que a Business Profile API exige pedido de acesso ao Google.

### Etapa 8 — Creative Studio e Learning Engine
Tabelas de hipóteses, experimentos, criativos e aprendizados. Geração de variações de texto
(títulos, descrições, CTA, AIDA/PAS) pela Claude API, sem inventar preços ou promessas (usar só
dados cadastrados). Registro de testes A/B e do que funcionou, consultado pelo Diretor.
**Pronto quando:** dá para pedir variações de um produto, salvar, e ver o histórico de experimentos.

### Etapa 9 — Campaign Manager
O Diretor monta um rascunho de campanha (objetivo, público, orçamento dentro dos limites,
criativos). Após aprovação humana, publica na plataforma conectada **PAUSADA**; ativação é outra
aprovação. Tudo registrado em `trafego_acoes`.
**Pronto quando:** fluxo rascunho → aprovação → publicação pausada funciona com o provedor (testar só com dados simulados).

### Etapa 10 — Autonomia supervisionada
Chave "Autonomia da JUDITE" por workspace (desligada por padrão). Ligada, o Diretor pode
sozinho: pausar campanha com gasto alto e zero conversões após volume mínimo; reduzir verba;
aumentar dentro dos limites (máx. 10%/ajuste e teto mensal). Tudo acima vira aprovação.
Botão "Parar tudo" que desliga a autonomia na hora.
**Pronto quando:** regras cobertas por testes Vitest e visíveis no histórico de ações.

### Etapa final — Entrega
Atualize `docs/PENDENTE.md` com: migrações a aplicar (em ordem), variáveis novas, liberações
externas e um **roteiro de testes para amanhã**, tela por tela, em português simples.
Faça o último push na `desenvolvimento` e escreva no PROGRESSO.md um resumo final.
