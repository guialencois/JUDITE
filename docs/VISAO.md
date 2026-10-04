# JUDITE — AI Chief Marketing Officer

> Leia este arquivo antes de qualquer tarefa. Ele é a fonte da verdade sobre o que a JUDITE é,
> as regras do projeto e a ordem de construção.

## O que é

A JUDITE é uma plataforma **multiempresa** que atua como Diretora de Marketing (CMO) com IA.
Ela planeja, cria, publica, mede e otimiza campanhas **reais**, com autonomia progressiva,
sempre dentro das políticas de orçamento e governança de cada workspace.

- **O humano** só ajusta preço e aprova/reprova o que estiver acima dos limites.
- **Sem Windsor ou qualquer intermediário pago.** Toda integração é feita pelas APIs oficiais
  (Meta Marketing API, Google Ads API, TikTok Marketing API, Google Business Profile API,
  Google Search Console). O Windsor foi removido em 04/10/2026 (branch `desenvolvimento`).
- **LUNIKO** é o motor de execução separado (outro repositório e outro banco). A integração é
  feita só por API/webhooks assinados. Nunca fundir os projetos.

## Ciclo contínuo

monitorar → prever → decidir → criar → validar (orçamento, políticas, permissões) → executar → analisar → otimizar → aprender

Previsões são probabilísticas. Nenhuma verba muda por oscilação pequena: exigir volume mínimo de
conversões, respeitar a janela de atribuição e o período de aprendizado das plataformas.

## Módulos (agentes coordenados pelo Diretor)

| Módulo | Faz | Situação |
|---|---|---|
| Diretor (CMO) | Coordena os agentes, decide a próxima ação | a construir |
| Marketing Intelligence | Tendências, concorrência, sazonalidade, previsão | a construir |
| Campaign Manager | Cria e gerencia campanhas reais nas plataformas | a construir |
| Traffic Manager | Segmentação, orçamento, lances, pausar/ativar | parcial (Gerenciador + `src/lib/trafego/limites.ts`) |
| Creative Studio | Copy (AIDA, PAS), imagens, vídeos, testes A/B | a construir |
| Audience Intelligence | Públicos, remarketing, semelhantes, leads | a construir |
| Marketing Analytics | Atribuição, funil, CRO | parcial (aba Site: anúncio → visita → WhatsApp) |
| SEO / AEO / Local | Site no Google, conteúdo, **Perfil da Empresa no Google (Google Meu Negócio)** | a construir |
| Social Intelligence | Menções, sentimento, reputação | a construir |
| Budget & ROI | ROAS, CAC, LTV, orçamento mensal | parcial (limites por workspace) |
| Learning Engine | Hipóteses, experimentos, memória do que funcionou | a construir |

## Governança (o que a IA pode fazer sozinha)

| Controle | Padrão | Situação |
|---|---|---|
| Orçamento diário sem aprovação | R$ 100 | pronto (tela Limites da IA) |
| Teto absoluto por campanha | R$ 5.000/dia | pronto |
| Variação máxima por ajuste | 10% (hoje 50% no banco; reduzir) | pronto, ajustar padrão |
| Orçamento mensal máximo | R$ 2.000 | a construir |
| Campanha nova | exige aprovação | a construir |
| Troca de criativo | configurável | a construir |
| Pausar campanha ruim | permitido dentro das regras | parcial |
| Publicar no Perfil da Empresa no Google | exige aprovação até o dono liberar | a construir |

Regra fixa: a automação **nunca** confirma sozinha uma ação acima do limite. Ela registra como
`aguardando_aprovacao` e espera o humano.

## Regras de desenvolvimento

1. **Segurança primeiro:** RLS em toda tabela nova (por `workspace_id`), zod em toda entrada,
   service role só no servidor e só depois de checar quem pediu, tokens de plataformas sempre
   criptografados (`src/lib/cripto.ts` + `src/lib/conexoes/segredos.ts`), nunca afrouxar os freios.
2. **Next.js 16:** `proxy.ts` no lugar de middleware. Leia `node_modules/next/dist/docs` antes de usar APIs.
3. **Migrações:** escrever o SQL em `supabase/migrations`, mostrar ao Jackson e só então aplicar.
4. **Micro-etapas:** ao fim de cada etapa, rodar `npm run lint` e `npm run build`, explicar em
   português simples o que mudou e parar para o Jackson testar.
5. **Comunicação:** sempre em português do Brasil. O Jackson é iniciante: dizer onde colar cada
   comando (PowerShell, site da Vercel, site do Supabase, site da plataforma).
6. **Nada de dado inventado** em tela ou em anúncio (preços, avaliações, durações).

## Ordem de construção

- [x] Fase 0–2: base segura, login por convite, workspaces, limites, Dashboard/Gerenciador, Conexões, aba Site.
- [ ] **Fase 3 — Dados entrando, sem Windsor**
  1. Diagnosticar a aba Site (0 visitas): o guialencois.org carrega `https://judite-pi.vercel.app/j.js`
     com `data-chave` 9665d30b2a73f4998673bbf9517d3155 e envia para `/api/coleta`.
  2. Remover o Windsor (arquivo, variável `WINDSOR_API_KEY`, textos) e criar o provedor nativo da
     **Meta** (leitura e ações) em `src/lib/anuncios/`, usando a conexão da página Conexões.
  3. Provedor nativo do **TikTok Ads** (conexão + leitura + ações).
  4. Provedor nativo do **Google Ads** (quando o developer token for aprovado).
- [ ] **Fase 4 — Comercial e Budget & ROI:** vendas do WhatsApp, metas, ROAS real, CAC, orçamento mensal.
- [ ] **Fase 5 — Diretor v1:** análise diária com IA e recomendações (sem executar).
- [ ] **Fase 6 — Local e SEO:** conexão com o **Perfil da Empresa no Google** (avaliações, posts,
  fotos, informações) e o **Search Console**; o Diretor sugere melhorias para o site e o perfil.
- [ ] **Fase 7 — Creative Studio e Learning Engine:** variações de anúncio, testes A/B, memória.
- [ ] **Fase 8 — Campaign Manager:** a JUDITE cria campanhas reais (campanha nova exige aprovação).
- [ ] **Fase 9 — Autonomia supervisionada:** realocar verba e pausar dentro da governança; ponte com o LUNIKO.
- [ ] **Fase 10 — Inteligência ampliada:** social listening, previsão, sazonalidade, personalização.

## Limites externos (não dependem de código)

Cada plataforma exige liberação do dono da conta, com prazos próprios:
- **Google Ads:** developer token (Central de API da conta de administrador).
- **Perfil da Empresa no Google:** pedido de acesso à Business Profile API no Google Cloud.
- **Meta:** app em developers.facebook.com + usuário do sistema no Gerenciador de Negócios.
- **TikTok:** app em business-api.tiktok.com (passa por revisão).
A JUDITE mostra o passo a passo de cada uma na página Conexões.
