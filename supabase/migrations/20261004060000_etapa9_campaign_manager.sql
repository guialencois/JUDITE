-- Etapa 9: Campaign Manager (rascunho -> aprovação -> publicação PAUSADA -> ativação com outra aprovação).
-- NÃO APLICADA. Escrita no modo autônomo; o Jackson revisa e aplica (ver docs/PENDENTE.md).
-- Depende da migração da Etapa 8 (tabela produtos).
-- Leitura: membros. Escrita: só o servidor, depois de conferir o papel (rascunho: dono/admin; aprovar e ativar: SÓ O DONO).

create table public.campanha_rascunhos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id) on delete set null,
  origem text not null default 'painel' check (origem in ('painel','diretor')),
  plataforma text not null check (plataforma in ('google_ads','facebook','tiktok')),
  nome text not null check (char_length(nome) between 3 and 150),
  objetivo text not null check (objetivo in ('trafego','mensagens','conversoes','reconhecimento')),
  orcamento_diario numeric(14,2) not null check (orcamento_diario > 0 and orcamento_diario <= 5000),
  -- Descrição do público para montar o conjunto de anúncios (região, idades, interesses).
  publico jsonb not null default '{}'::jsonb,
  produto_id uuid references public.produtos(id) on delete set null,
  criativo_ids uuid[] not null default '{}',
  justificativa text check (char_length(justificativa) <= 2000),
  -- Avisos dos freios no momento em que o rascunho foi montado (ex.: passa do orçamento mensal).
  avisos jsonb not null default '[]'::jsonb,
  status text not null default 'aguardando_aprovacao'
    check (status in ('aguardando_aprovacao','publicada_pausada','ativa','recusada','erro')),
  -- true = a publicação foi apenas simulada (nada foi criado na plataforma).
  simulada boolean not null default false,
  campanha_externa_id text check (char_length(campanha_externa_id) <= 64),
  decidido_por uuid references auth.users(id) on delete set null,
  decidido_em timestamptz,
  ativado_por uuid references auth.users(id) on delete set null,
  ativado_em timestamptz,
  resultado text check (char_length(resultado) <= 500)
);
create index campanha_rascunhos_ws_idx on public.campanha_rascunhos(workspace_id, criado_em desc);

alter table public.campanha_rascunhos enable row level security;
revoke all on public.campanha_rascunhos from anon;

create policy "membros leem rascunhos de campanha" on public.campanha_rascunhos
  for select to authenticated using ((select private.is_member(workspace_id)));
-- Sem política de escrita: só o servidor grava, depois de conferir quem pediu.
