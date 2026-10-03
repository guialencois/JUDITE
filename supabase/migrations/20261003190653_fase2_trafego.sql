-- Fase 2b: painel de tráfego, separado por workspace
-- Já aplicada no projeto Supabase "JUDITE". Guardada aqui como registro.
create table public.trafego_contas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plataforma text not null check (plataforma in ('google_ads','facebook')),
  conta_externa text not null,
  nome text,
  moeda text not null default 'BRL',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (plataforma, conta_externa)
);
create index trafego_contas_ws_idx on public.trafego_contas(workspace_id);

create table public.trafego_metricas_dia (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  data date not null,
  plataforma text not null check (plataforma in ('google_ads','facebook')),
  conta_externa text not null,
  campanha_id text not null default '',
  campanha text not null default '',
  anuncio_id text not null default '',
  anuncio text not null default '',
  gasto numeric(14,4) not null default 0,
  impressoes bigint not null default 0,
  cliques bigint not null default 0,
  page_views bigint,
  add_to_cart bigint,
  checkout bigint,
  compras numeric(14,4) not null default 0,
  receita numeric(14,4) not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (workspace_id, data, plataforma, conta_externa, campanha_id, anuncio_id)
);
create index trafego_metricas_ws_data_idx on public.trafego_metricas_dia(workspace_id, data desc);

create table public.trafego_campanhas (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plataforma text not null check (plataforma in ('google_ads','facebook')),
  campanha_id text not null,
  conta_externa text not null,
  nome text not null default '',
  status text,
  orcamento_diario numeric(14,2),
  moeda text not null default 'BRL',
  atualizado_em timestamptz not null default now(),
  primary key (workspace_id, plataforma, campanha_id)
);

create table public.trafego_acoes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  criado_em timestamptz not null default now(),
  usuario_id uuid references auth.users(id) on delete set null,
  origem text not null default 'painel' check (origem in ('painel','automacao')),
  plataforma text not null,
  tipo_entidade text not null check (tipo_entidade in ('campanha','conjunto','anuncio')),
  entidade_id text not null,
  entidade_nome text,
  acao text not null,
  valor_antes text,
  valor_depois text,
  status text not null check (status in ('aplicada','erro','aguardando_aprovacao')),
  resultado text,
  duracao_ms integer
);
create index trafego_acoes_ws_idx on public.trafego_acoes(workspace_id, criado_em desc);

create table public.trafego_metas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mes date not null,
  metrica text not null check (metrica in ('faturamento','investimento','compras','roas','cpa')),
  alvo numeric(14,2) not null check (alvo >= 0),
  criado_em timestamptz not null default now(),
  unique (workspace_id, mes, metrica)
);

create table public.trafego_vendas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  data date not null,
  produto text not null check (char_length(produto) between 1 and 120),
  pessoas integer not null default 1 check (pessoas between 1 and 1000),
  valor numeric(14,2) not null check (valor >= 0),
  origem text,
  campanha_id text,
  observacao text check (char_length(observacao) <= 500),
  externo_id text,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (workspace_id, externo_id)
);
create index trafego_vendas_ws_data_idx on public.trafego_vendas(workspace_id, data desc);

create table public.trafego_sincronizacoes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  iniciado_em timestamptz not null default now(),
  terminado_em timestamptz,
  conector text not null,
  linhas integer not null default 0,
  status text not null default 'rodando' check (status in ('rodando','ok','erro')),
  erro text
);
create index trafego_sync_ws_idx on public.trafego_sincronizacoes(workspace_id, iniciado_em desc);

create table public.trafego_config (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  chave text not null check (chave in ('orcamento_max_sem_aprovacao','aumento_max_por_vez_percent','custos_percent')),
  valor numeric(14,2) not null check (valor >= 0),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  primary key (workspace_id, chave)
);

-- Todo workspace nasce com os limites padrão
create or replace function private.config_padrao()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.trafego_config (workspace_id, chave, valor) values
    (new.id, 'orcamento_max_sem_aprovacao', 100),
    (new.id, 'aumento_max_por_vez_percent', 50),
    (new.id, 'custos_percent', 25)
  on conflict do nothing;
  return new;
end; $$;
revoke execute on function private.config_padrao() from public, anon, authenticated;
create trigger workspaces_config_padrao after insert on public.workspaces
  for each row execute function private.config_padrao();

insert into public.trafego_config (workspace_id, chave, valor)
  select w.id, v.chave, v.valor from public.workspaces w
  cross join (values ('orcamento_max_sem_aprovacao', 100), ('aumento_max_por_vez_percent', 50), ('custos_percent', 25)) as v(chave, valor)
on conflict do nothing;

-- Segurança: RLS em tudo, leitura só para membros do workspace
do $$
declare t text;
begin
  foreach t in array array['trafego_contas','trafego_metricas_dia','trafego_campanhas','trafego_acoes',
                           'trafego_metas','trafego_vendas','trafego_sincronizacoes','trafego_config'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy "membros leem" on public.%I for select to authenticated using ((select private.is_member(workspace_id)))', t);
  end loop;
end $$;

-- Escrita pela tela: metas (dono/admin), vendas (membros), limites (dono/admin, só alterar valor)
create policy "dono ou admin define metas" on public.trafego_metas
  for all to authenticated using ((select private.has_role(workspace_id, array['owner','admin'])))
  with check ((select private.has_role(workspace_id, array['owner','admin'])));
create policy "membros registram vendas" on public.trafego_vendas
  for insert to authenticated with check ((select private.is_member(workspace_id)) and criado_por = (select auth.uid()));
create policy "dono ou admin corrige vendas" on public.trafego_vendas
  for update to authenticated using ((select private.has_role(workspace_id, array['owner','admin'])))
  with check ((select private.has_role(workspace_id, array['owner','admin'])));
create policy "dono ou admin apaga vendas" on public.trafego_vendas
  for delete to authenticated using ((select private.has_role(workspace_id, array['owner','admin'])));
create policy "dono ou admin ajusta limites" on public.trafego_config
  for update to authenticated using ((select private.has_role(workspace_id, array['owner','admin'])))
  with check ((select private.has_role(workspace_id, array['owner','admin'])) and atualizado_por = (select auth.uid()));

-- Métricas, campanhas, contas, sincronizações e histórico de ações:
-- sem política de escrita. Só o servidor (service role) grava, depois de checar quem pediu.
