-- Etapa 7: Presença no Google (Perfil da Empresa + Search Console).
-- NÃO APLICADA. Escrita no modo autônomo; o Jackson revisa e aplica (ver docs/PENDENTE.md).

-- 1) Nova conexão "google_presenca" (refresh token criptografado, igual às outras).
--    Depende da migração da Etapa 4 (que já incluiu 'tiktok' nesta lista).
alter table public.conexoes drop constraint if exists conexoes_provedor_check;
alter table public.conexoes add constraint conexoes_provedor_check
  check (provedor in ('google_ads','meta','tiktok','google_presenca'));

-- 2) Fila de ações no Perfil da Empresa. Nada é publicado no Google sem aprovação do dono:
--    a resposta ou o post nasce como "aguardando_aprovacao" e só vira "publicada" depois do clique.
create table public.presenca_acoes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id) on delete set null,
  origem text not null default 'painel' check (origem in ('painel','diretor')),
  tipo text not null check (tipo in ('responder_avaliacao','publicar_post')),
  -- Para resposta: nome da avaliação no Google (accounts/x/locations/y/reviews/z).
  alvo text check (char_length(alvo) <= 300),
  -- Trecho da avaliação, para o dono lembrar do contexto ao aprovar.
  contexto text check (char_length(contexto) <= 1000),
  conteudo text not null check (char_length(conteudo) between 1 and 1500),
  status text not null default 'aguardando_aprovacao'
    check (status in ('aguardando_aprovacao','publicada','recusada','erro')),
  decidido_por uuid references auth.users(id) on delete set null,
  decidido_em timestamptz,
  resultado text check (char_length(resultado) <= 500)
);
create index presenca_acoes_ws_idx on public.presenca_acoes(workspace_id, criado_em desc);

alter table public.presenca_acoes enable row level security;
revoke all on public.presenca_acoes from anon;

create policy "membros leem acoes de presenca" on public.presenca_acoes
  for select to authenticated using ((select private.is_member(workspace_id)));
-- Sem política de escrita: só o servidor grava, depois de confirmar o papel de quem pediu
-- (dono ou admin escrevem o rascunho; SÓ O DONO aprova a publicação).
