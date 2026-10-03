-- Conexões nativas (Google Ads, Meta Ads) por workspace.
-- Já aplicada no projeto Supabase "JUDITE". Guardada aqui como registro.
-- O campo "segredo" guarda tokens CRIPTOGRAFADOS pelo servidor (AES-256-GCM);
-- nem os membros do workspace conseguem ler essa coluna.
create table public.conexoes (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provedor text not null check (provedor in ('google_ads','meta')),
  dados jsonb not null default '{}'::jsonb,
  segredo text,
  conectado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  primary key (workspace_id, provedor)
);

alter table public.conexoes enable row level security;
revoke all on public.conexoes from anon, authenticated;
grant select (workspace_id, provedor, dados, conectado_em, atualizado_em) on public.conexoes to authenticated;

create policy "membros veem status das conexoes" on public.conexoes
  for select to authenticated using ((select private.is_member(workspace_id)));
-- Sem política de escrita: só o servidor grava, depois de confirmar que quem pediu é o dono.
