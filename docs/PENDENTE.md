# Pendências para o Jackson (e para revisão do Claude no chat)

> Atualizado em 04/10/2026, no fim do modo autônomo. As 10 etapas foram implementadas na branch
> `desenvolvimento` (nada foi para a `main`). Tudo compila (`npm run lint` e `npm run build` passam)
> e os 160 testes automáticos passam (`npx vitest run`).
>
> **O que NÃO foi feito por mim, de propósito:** nenhuma migração foi aplicada, nenhuma API de
> plataforma foi chamada com credenciais, o `.env.local` não foi lido, e nada foi publicado em produção.

## Antes de tudo: como ver a versão nova

1. Abra o site da **Vercel** → projeto JUDITE → **Deployments**. Procure o deploy mais recente da branch
   `desenvolvimento` (aparece como "Preview"). Clique nele e depois em **Visit**.
2. Esse endereço de prévia usa o **mesmo banco** da produção. Por isso as telas novas só funcionam por
   completo depois das migrações abaixo. Sem elas, cada tela mostra um aviso amarelo explicando o que falta.
3. Para rodar no seu computador (opcional), no **PowerShell**, dentro da pasta `judite`:
   ```
   git switch desenvolvimento
   npm install
   npm run dev
   ```
   e abra `http://localhost:3000`.

## Migrações

> **Situação em 05/10/2026:** as 9 migrações da tabela abaixo estão aplicadas no banco JUDITE (as duas últimas pelo Claude Code, a pedido do Jackson; a nº 7 já estava aplicada). Não há migração pendente.

Aplicar **nesta ordem**. Onde: site do **Supabase** → projeto JUDITE → **SQL Editor** → **New query** →
copiar o conteúdo do arquivo (pasta `supabase/migrations`), colar e clicar em **Run**. Uma de cada vez.
Peça ao Claude no chat para revisar cada arquivo antes, se quiser.

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `20261004010000_etapa4_tiktok.sql` | Aceita `tiktok` como plataforma nas tabelas de tráfego e como conexão. Só amplia listas. |
| 2 | `20261004020000_etapa5_orcamento_mensal.sql` | Cria o limite "orçamento mensal máximo" (R$ 2.000 para todo workspace) e troca o padrão de aumento por ajuste de 50% para 10% (só para quem ainda está em 50%). |
| 3 | `20261004030000_etapa6_diretor.sql` | Tabelas `diretor_relatorios` e `diretor_recomendacoes`. |
| 4 | `20261004040000_etapa7_presenca_google.sql` | Conexão `google_presenca` e a fila de aprovações `presenca_acoes`. **Precisa da nº 1 antes.** |
| 5 | `20261004050000_etapa8_creative_learning.sql` | Tabelas `produtos`, `criativos`, `hipoteses`, `experimentos`, `aprendizados`. |
| 6 | `20261004060000_etapa9_campaign_manager.sql` | Tabela `campanha_rascunhos`. **Precisa da nº 5 antes.** |
| 7 | `20261004070000_etapa10_autonomia.sql` | Tabela `autonomia` (chave ligada/desligada por workspace; nasce desligada). |
| 8 | `20261005010000_diretor_trafego_aprovacoes.sql` | Permite marcar uma ação da autonomia como `aprovada` ou `dispensada` na página **Diretor de Tráfego**. Só amplia uma lista de valores. Sem ela, a página funciona, mas os botões Aprovar/Dispensar dessas ações avisam que falta a migração. |
| 9 | `20261005020000_cmo_autonoma.sql` | CMO autônoma: guarda o plano completo de cada campanha, os novos estados (aprendizado, otimização, pausada pela JUDITE, concluída...), o histórico de cada mudança (`campanha_eventos`), as ideias (`campanha_ideias`), o registro do ciclo diário (`cmo_execucoes`), o nível de autonomia e os limites por canal. **Precisa das nº 2, 5, 6 e 7 antes.** Só acrescenta; não apaga nada. |

Observações:
- Todas as tabelas novas têm `workspace_id` e RLS ligado: membros leem; escrita só pelo servidor ou por dono/admin.
- Conferi no banco (só leitura) que os nomes das restrições que as migrações 1, 2 e 4 trocam existem exatamente como escrevi.
- **Efeito que você vai notar depois da nº 2:** aumentos de verba acima de 10% de uma vez passam a pedir confirmação (antes era 50%).
- Nenhuma migração apaga dados.

## Variáveis de ambiente novas

Onde colocar: site da **Vercel** → projeto JUDITE → **Settings → Environment Variables** (marque Production e Preview)
e, para o seu computador, no arquivo `.env.local`. Depois de mudar na Vercel, faça **Redeploy**.

| Nome | Para que serve | Onde conseguir |
|---|---|---|
| `GEMINI_API_KEY` | **Recomendada.** Liga a IA do Diretor, do Creative Studio e do rascunho de campanha usando o Google Gemini (plano grátis do AI Studio). Sem chave nenhuma, as telas explicam o que falta e o resto funciona. | `aistudio.google.com/apikey` → entrar com a conta Google → **Criar chave de API**. Não pede cartão. O plano grátis tem limite de pedidos por minuto e por dia. |
| `ANTHROPIC_API_KEY` | Alternativa paga (Claude, modelo Sonnet). Só é usada se não houver `GEMINI_API_KEY` ou se `IA_PROVEDOR=anthropic`. | `console.anthropic.com` → API Keys → Create Key. O uso é cobrado pela Anthropic conforme o consumo. |
| `LUNIKO_WEBHOOK_URL` e `LUNIKO_WEBHOOK_SECRET` | **Opcionais. Deixe vazias por enquanto.** Ligam o aviso ao LUNIKO a cada mudança de estado de campanha (contrato em `docs/CONTRATO-LUNIKO.md`). | Só quando o LUNIKO tiver o endereço para receber. |
| `SITE_URL` | Endereço definitivo do site, sem barra no fim. As URLs de retorno do login nas plataformas são montadas a partir dela. | Você define (ex.: `https://judite-pi.vercel.app`). |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | App da JUDITE no Google: liga o botão **Conectar com Google**. | Google Cloud. Passo a passo em `docs/CONEXOES-OAUTH.md`, parte a. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Deixa listar contas e ler/mudar campanhas do Google Ads. | Conta de administrador do Google Ads → Central de API (parte b). |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | **Opcional.** 10 números da conta de administrador (MCC). | Parte b. |
| `META_APP_ID`, `META_APP_SECRET` | App da JUDITE na Meta: liga o botão **Conectar com Facebook**. | Meta for Developers (parte c). |
| `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` | App da JUDITE no TikTok: liga o botão **Conectar com TikTok**. | TikTok for Business Developers (parte d). |
| `IA_PROVEDOR` | **Opcional.** `gemini` ou `anthropic`, para forçar um provedor. Vazia: usa o Gemini se `GEMINI_API_KEY` existir, senão a Anthropic. | Você decide. |
| `JUDITE_PUBLICACAO_REAL` | **Deixe vazia.** Vazia = modo simulado (aprovar campanha não cria nada nas plataformas). Só coloque `1` quando decidir criar campanhas de verdade (sempre pausadas). | Você decide. |

- **Pode apagar:** `WINDSOR_API_KEY` (da Vercel e do `.env.local`). Não é mais lida por nada.
- Continuam valendo: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `JUDITE_CHAVE_CRIPTO`, etc.

## Liberações externas necessárias

| Plataforma | O que pedir | Onde | Situação no código |
|---|---|---|---|
| **Google Ads** | Developer token com "Acesso básico" | Conta de administrador do Google Ads → Central de API | Pronto. Sem aprovação, a sincronização mostra a mensagem "ainda está em acesso de teste". |
| **Perfil da Empresa no Google** | Pedido de acesso à Business Profile API para o projeto do Google Cloud | Formulário do Google (passo a passo em Conexões → Presença no Google) | Pronto. Sem aprovação, a parte do perfil mostra aviso; o Search Console funciona. |
| **Google Cloud** | Ativar as APIs: Search Console, My Business Account Management, My Business Business Information, Business Profile Performance, Google My Business. Adicionar os escopos `business.manage` e `webmasters.readonly` na tela de permissão OAuth | `console.cloud.google.com` | O redirecionamento é o mesmo já cadastrado para o Google Ads. |
| **Meta** | App em `developers.facebook.com` + usuário do sistema com `ads_read`, `ads_management`, `business_management` | Passo a passo em Conexões | Pronto (leitura, pausar/ativar, orçamento, criar campanha pausada). |
| **TikTok** | App em `business-api.tiktok.com` (passa por revisão) com permissões de Ads Management e Reporting; cadastrar o endereço de retorno mostrado em Conexões | Passo a passo em Conexões | Pronto. |
| **Google AI Studio (Gemini)** | Uma chave de API do plano grátis | `aistudio.google.com/apikey` | Pronto. É o provedor padrão da IA. |
| **Anthropic** (opcional) | Conta com crédito e uma API key, só se quiser usar o Claude no lugar do Gemini | `console.anthropic.com` | Pronto. |
| **Vercel** | Conferir se o plano aceita **dois** crons diários (`/api/trafego/sync` às 09h00 UTC e `/api/diretor/cron` às 09h30 UTC) | Vercel → Settings → Cron Jobs | Se o deploy reclamar do segundo cron, me avise: a saída é chamar o Diretor de dentro do cron de sincronização. |

## Bloqueios e dúvidas

Nada ficou travado, mas estes pontos **não puderam ser testados de verdade** e precisam de atenção:

1. **Nenhuma API externa foi exercitada com conta real.** Meta, Google Ads, TikTok, Perfil da Empresa, Search Console
   e Claude API foram escritas a partir da documentação que conheço e dos testes com dados de exemplo.
   Não consegui abrir a documentação oficial de dentro do modo autônomo; o que fiz foi confirmar, sem credenciais,
   quais **versões** respondem hoje: Meta `v26.0`, Google Ads `v26`, TikTok `v1.3`. As versões ficam em constantes
   em `src/lib/conexoes/config.ts`. É provável que o primeiro uso real revele algum campo a ajustar.
2. **TikTok: valor das compras.** Leio gasto, impressões, cliques e conversões, mas **não** leio o valor das compras
   (receita fica 0), para não arriscar um nome de campo errado. O faturamento real vem da página Comercial.
3. **Google Ads: criar campanha.** Não implementado (a criação exige campos que não pude confirmar). Ler, pausar,
   ativar e mudar orçamento estão prontos.
4. **Campaign Manager no modo real** cria só a "casca" da campanha (nome, objetivo, orçamento), pausada. Conjunto de
   anúncios e anúncios são finalizados na plataforma. Decidi não inventar os campos de público e criativo da API.
5. **Aprovações pendentes da automação: resolvido.** A página **Diretor de Tráfego** junta numa fila só as campanhas
   propostas, as ativações, as ações que a autonomia deixou `aguardando_aprovacao` e as recomendações de verba, cada uma
   com Aprovar e Recusar/Dispensar. Precisa da migração nº 8 para as ações da autonomia.
6. **Autonomia e conversões.** A autonomia só pausa por "zero conversões" se a plataforma mede conversão em alguma
   campanha. Como a venda do Guia Lençóis acontece no WhatsApp, é provável que ela quase nunca aja até existir um
   evento de conversão configurado (ex.: clique no WhatsApp como conversão no pixel). É o comportamento seguro.
7. **Aba Site: resolvido.** O "0 visitas" era de antes das 23h57 de 03/10. Já há visitas gravadas. O modo de teste
   novo (`?judite_teste=1`) só funciona depois que esta branch estiver no ar no endereço `judite-pi.vercel.app`
   (ou seja, depois do merge na `main`), porque o site carrega o `j.js` de lá.
8. **Dúvida de produto:** a página Comercial aceita o nome do produto digitado à mão, e o Creative Studio tem um
   cadastro de produtos separado. Vale ligar os dois (escolher o produto de uma lista ao registrar a venda)?
9. **IA pelo Gemini: a chamada real não foi testada** (não há chave no ambiente). O pedido segue a documentação
   oficial conferida em 04/10/2026 (`generateContent`, modelo `gemini-3.8-flash`, saída em JSON com schema) e está
   coberto por testes com respostas simuladas. Pontos a observar no primeiro uso real: (a) se o Google recusar algum
   detalhe do schema, a tela mostra "O Gemini recusou o pedido: ..." — copie a mensagem para mim; (b) no plano grátis
   o Google pode usar os textos enviados para melhorar os produtos dele (vale ler os termos do AI Studio); (c) o cron
   diário faz um pedido por workspace, bem abaixo do limite grátis.
10. **CMO autônoma: o que ainda depende de fora.** (a) A geração real pela IA não foi testada (sem chave no ambiente); o motor
    inteiro está coberto por testes com a IA simulada. (b) **Google Ads não cria campanha pela JUDITE**: aprovar uma proposta de
    Google Ads em modo real devolve "crie na plataforma seguindo o rascunho"; ler, pausar, ativar e mudar verba funcionam.
    (c) Meta e TikTok criam só a "casca" pausada; público, palavras-chave e anúncios do plano são finalizados na plataforma.
    (d) Os níveis 3 e 4 de autonomia aparecem na tela, mas não podem ser ligados. (e) "Mercado" hoje são os dados da própria
    empresa (campanhas, site, vendas); tendências, sazonalidade e concorrência ainda não têm fonte de dados.
11. **Conexões por OAuth ("Conectar e pronto"): nada testado com conta real.** O código segue a documentação oficial
    (diálogo e troca de código da Meta, token de longa duração, `appsecret_proof`, hierarquia de contas do Google Ads) e está
    coberto por testes com respostas simuladas. Não consegui abrir a página oficial de três chamadas, que escrevi como as conheço:
    `customers:listAccessibleCustomers` (Google Ads), `oauth2/advertiser/get` (TikTok) e `DELETE /me/permissions` (Meta).
    Se alguma falhar no primeiro uso, a tela mostra a mensagem; copie para mim. Nenhuma migração foi necessária.
12. `docs/VISAO.md` ainda lista as fases como não concluídas: deixei para você marcar depois de testar.

## Roteiro de testes para amanhã

Faça na **prévia** da branch `desenvolvimento` (veja "Antes de tudo"). Sugestão: testar primeiro **sem** aplicar
migrações (passos 1 a 3), depois aplicar as 7 migrações e seguir.

### 1. Site (não precisa de migração)
- [ ] Abra **Site**. Deve aparecer a faixa "Última visita recebida" com data e hora, e "Último teste: nenhum".
- [ ] Os números de visitantes devem estar maiores que zero (já existem visitas de ontem à noite).
- [ ] O teste `https://www.guialencois.org/?judite_teste=1` só vale depois do merge na `main` (ver item 7 acima).

### 2. Tráfego e Gerenciador (não precisa de migração)
- [ ] Abra **Tráfego**. Deve aparecer o aviso amarelo listando as plataformas ainda não conectadas, com link para Conexões.
- [ ] Os botões "Todas as plataformas / Google Ads / Meta Ads / TikTok Ads" filtram os números.
- [ ] Se a Meta já estiver conectada: clique em **Sincronizar dados**. Deu erro? Copie a mensagem para mim.
- [ ] **Gerenciador**: cada campanha mostra a plataforma embaixo do nome; o histórico tem a coluna "Quem".

### 3. Comercial (não precisa de migração)
- [ ] Abra **Comercial**. Registre uma venda de teste (data de hoje, um produto, 2 pessoas, um valor).
- [ ] Confira: Faturamento, Vendas e Ticket médio mudam; a venda aparece em "Vendas do mês" e em "Desempenho por produto".
- [ ] "Definir metas do mês" → coloque uma meta de faturamento → aparece o anel com o percentual.
- [ ] ROAS real e CAC ficam "-" enquanto não houver gasto sincronizado. Isso é o esperado.
- [ ] Apague a venda de teste (botão "apagar").

### 4. Aplicar as 7 migrações (Supabase → SQL Editor), na ordem da tabela acima

### 5. Limites da IA
- [ ] **Visão geral** → "Limites da IA": agora há 4 campos. O "Aumento máximo por vez" deve mostrar 10 e o
      "Orçamento mensal máximo" 2000. Mude um valor, salve e confira que ficou.

### 6. Conexões (login direto nas plataformas)
Antes: faça a configuração de administrador de `docs/CONEXOES-OAUTH.md` (uma vez) e o Redeploy.
- [ ] No fim da página, a caixa **Configuração do administrador** mostra as 3 URLs de retorno e ✓ nas plataformas configuradas.
- [ ] **Conectar com Google** → login → volta com a lista de contas → escolha a conta → o cartão mostra o nome e o ID.
- [ ] **Trocar conta** abre a mesma lista. **Desconectar** remove e avisa se o acesso foi revogado no Google.
- [ ] **Conectar com Facebook** → login → escolha a conta de anúncios. O cartão mostra por quantos dias o acesso vale.
- [ ] **Conectar com TikTok** (depois de o app ser aprovado) → escolha o anunciante pelo nome.
- [ ] Em cada cartão, **Opções avançadas** fica recolhido e traz o formulário antigo.
- [ ] Entre com um usuário que não é o dono: os botões de conectar e a caixa do administrador não aparecem.
- [ ] Depois de conectar: **Tráfego** → **Sincronizar dados**.

### 7. Presença no Google
- [ ] Abra **Presença no Google** → em Configuração, escolha a propriedade do Search Console → Salvar.
- [ ] Devem aparecer cliques, impressões, posição média e as tabelas de consultas e páginas.
- [ ] Se o perfil ainda não foi liberado pelo Google, deve aparecer um aviso amarelo explicando (e não uma tela de erro).
- [ ] Se já foi liberado: escreva uma resposta a uma avaliação → ela fica "aguardando aprovação" → **só publica** depois de "Aprovar e publicar".

### 8. Diretor
- [ ] Sem chave nenhuma: a página explica como criar a `GEMINI_API_KEY` (grátis, em `aistudio.google.com/apikey`).
- [ ] Cadastre a `GEMINI_API_KEY` na Vercel (Production e Preview), faça Redeploy e clique em **Gerar relatório agora** (leva até 1 minuto).
- [ ] Leia o relatório: **os números citados batem com as telas?** Se a IA citar algo que não existe, me avise com a frase.
- [ ] Com poucos dados, o esperado é ela recomendar coletar dados (conectar plataformas, registrar vendas), não mexer em verba.
- [ ] Aprove uma recomendação que **não** seja de verba (ex.: site) e recuse outra.

### 9. Creative Studio
- [ ] Cadastre um produto de verdade, com preço e os fatos (duração, o que inclui).
- [ ] "Gerar variações" → confira se **nenhum** texto traz preço, desconto ou número que você não cadastrou.
- [ ] Clique em "salvar" em duas variações.
- [ ] Registre um experimento com essas duas (A e B), conclua com resultados de exemplo e veja a conclusão em Aprendizados.

### 10. Campanhas (modo simulado)
- [ ] A página deve mostrar a faixa azul "Modo simulado".
- [ ] "Montar um rascunho à mão": nome, Meta Ads, um objetivo, R$ 30 por dia → Salvar. Aparece "aguardando aprovação".
- [ ] Repita com R$ 300 por dia: devem aparecer avisos amarelos (acima do teto diário e do orçamento do mês).
- [ ] "Aprovar (simulado)" → vira "criada e pausada · SIMULADA". Depois "Aprovar ativação (simulado)" → "ativa · SIMULADA".
- [ ] Gerenciador → Histórico de ações: aparecem as linhas do rascunho, da criação e da ativação, marcadas como SIMULAÇÃO.
- [ ] Com a chave da IA e um produto cadastrado: "Pedir rascunho" ao Diretor e veja se o orçamento sugerido respeita os limites.

### 11. Autonomia
- [ ] Diretor → "Autonomia da JUDITE": deve estar **Desligada**.
- [ ] Marque a caixa e clique em "Ligar autonomia" → fica verde, com o botão vermelho **Parar tudo**.
- [ ] Clique em **Parar tudo** → volta a "Desligada".
- [ ] **Deixe desligada** por enquanto.

### 12. Diretor de Tráfego (central de campanhas da CMO)
Aplique antes as migrações nº 8 e nº 9. Sem a nº 9 a página avisa em amarelo o que fica faltando.
- [ ] No topo: **IA: Conectada: Google Gemini**, **Autonomia: Nível 1: Assistido**, **Modo simulado**.
- [ ] Cadastre um produto de verdade no Creative Studio (nome, preço, duração, o que inclui).
- [ ] **Criar automaticamente** → escolha o produto → aguarde até 1 minuto. A proposta aparece em "Para você avaliar".
- [ ] Na proposta: leia "O que ela quer fazer" e "Por quê". Clique em **Ver detalhes**: oportunidade, estratégia, hipótese,
      risco, confiança, dados utilizados, anúncios escritos e (no Google Ads) palavras-chave.
      **Confira se nenhum anúncio traz preço ou número que você não cadastrou.**
- [ ] **Editar** → mude o orçamento → Salvar. Abra **Histórico**: a edição aparece com data e valor.
- [ ] **Quero ideias** → aparecem até 3 ideias com público, canal, hipótese, orçamento e métrica. Clique em **Gerar campanha** em uma e **Descartar** em outra.
- [ ] **Criar campanha** (o terceiro quadro): preencha só o orçamento (ex.: 25) e a região. A proposta deve sair com R$ 25 por dia.
- [ ] Tente pedir duas vezes seguidas: a segunda deve avisar para aguardar um minuto.
- [ ] **Aprovar (simulado)** → vai para "Ligar campanha". **Aprovar ativação (simulado)** → aparece em "Campanhas da JUDITE em andamento".
- [ ] Em andamento: **Pausar**, depois **Retomar**, depois **Concluir**. O Histórico mostra cada passo e quem fez.
- [ ] **Recusar** uma proposta: ela some e a JUDITE não propõe a mesma combinação de produto e canal por 14 dias.
- [ ] "Nível de autonomia": escolha o nível 0 e salve; volte para o 1. Os níveis 3 e 4 aparecem apagados. **Não ligue o nível 2 ainda.**
- [ ] "Como a JUDITE trabalhou": cada pedido mostra as etapas (coleta, análise, decisão, geração, conferência, fila) com ✓ ou ✗.
- [ ] No dia seguinte: deve existir um "ciclo automático" das 06h30 com, no máximo, uma proposta nova.
- [ ] **Visão geral → Limites da IA**: há campos novos (redução máxima, teto por canal, bloquear canal). Bloqueie o TikTok, salve,
      e confira que as ideias e propostas não usam mais o TikTok. Depois libere de novo.

### 13. Se tudo estiver certo
- [ ] Me avise no chat para revisarmos juntos e fazer o merge da `desenvolvimento` na `main` (isso eu não fiz).
- [ ] Depois do merge, teste `https://www.guialencois.org/?judite_teste=1`: deve aparecer a faixa verde no canto do site.
