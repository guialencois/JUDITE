-- Aba Site: rastreador próprio da JUDITE (sem cookies, sem IP, sem dado pessoal)
-- Já aplicada no projeto Supabase "JUDITE". Guardada aqui como registro.
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dominio text not null check (dominio ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  chave text not null unique default encode(gen_random_bytes(16), 'hex'),
  criado_em timestamptz not null default now(),
  unique (workspace_id, dominio)
);

create table public.site_eventos (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ocorrido_em timestamptz not null default now(),
  tipo text not null check (tipo in ('pageview','whatsapp','carrinho','evento')),
  nome text check (char_length(nome) <= 80),
  caminho text not null default '/' check (char_length(caminho) <= 300),
  origem text check (char_length(origem) <= 120),
  utm_source text check (char_length(utm_source) <= 100),
  utm_medium text check (char_length(utm_medium) <= 100),
  utm_campaign text check (char_length(utm_campaign) <= 150),
  utm_content text check (char_length(utm_content) <= 150),
  anuncio text check (anuncio in ('google','meta','tiktok')),
  dispositivo text check (dispositivo in ('celular','tablet','computador')),
  pais text check (char_length(pais) <= 2),
  regiao text check (char_length(regiao) <= 10),
  cidade text check (char_length(cidade) <= 80),
  visitante text not null check (char_length(visitante) = 24)
);
create index site_eventos_ws_data_idx on public.site_eventos(workspace_id, ocorrido_em desc);
create index site_eventos_site_data_idx on public.site_eventos(site_id, ocorrido_em desc);

alter table public.sites enable row level security;
alter table public.site_eventos enable row level security;
revoke all on public.sites, public.site_eventos from anon;

create policy "membros veem sites" on public.sites
  for select to authenticated using ((select private.is_member(workspace_id)));
create policy "dono ou admin cadastra site" on public.sites
  for insert to authenticated with check ((select private.has_role(workspace_id, array['owner','admin'])));
create policy "dono ou admin remove site" on public.sites
  for delete to authenticated using ((select private.has_role(workspace_id, array['owner','admin'])));

create policy "membros veem eventos" on public.site_eventos
  for select to authenticated using ((select private.is_member(workspace_id)));
-- Eventos só são gravados pelo servidor (rota pública de coleta, com service role).
