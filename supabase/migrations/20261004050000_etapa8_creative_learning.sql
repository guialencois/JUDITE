-- Etapa 8: Creative Studio e Learning Engine.
-- NÃO APLICADA. Escrita no modo autônomo; o Jackson revisa e aplica (ver docs/PENDENTE.md).
-- Leitura: membros do workspace. Escrita: dono ou admin (pela tela, com RLS).

-- Produtos cadastrados: a ÚNICA fonte de fatos (preço, duração, o que inclui) para os textos da IA.
create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 120),
  descricao text check (char_length(descricao) <= 2000),
  preco numeric(14,2) check (preco is null or preco >= 0),
  -- Fatos livres: duração, o que inclui, ponto de encontro, diferenciais... só o que for verdade.
  detalhes text check (char_length(detalhes) <= 2000),
  publico text check (char_length(publico) <= 500),
  link text check (char_length(link) <= 300),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  unique (workspace_id, nome)
);
create index produtos_ws_idx on public.produtos(workspace_id);

create table public.criativos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete set null,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  origem text not null default 'ia' check (origem in ('ia','manual')),
  -- Variações geradas juntas compartilham o mesmo lote.
  lote uuid,
  formato text not null default 'livre' check (formato in ('AIDA','PAS','livre')),
  plataforma text check (plataforma in ('google_ads','facebook','tiktok')),
  titulo text not null check (char_length(titulo) between 1 and 200),
  descricao text check (char_length(descricao) <= 500),
  cta text check (char_length(cta) <= 80),
  texto text check (char_length(texto) <= 3000),
  status text not null default 'rascunho' check (status in ('rascunho','aprovado','arquivado'))
);
create index criativos_ws_idx on public.criativos(workspace_id, criado_em desc);

create table public.hipoteses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 500),
  status text not null default 'aberta' check (status in ('aberta','confirmada','refutada','inconclusiva')),
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null
);
create index hipoteses_ws_idx on public.hipoteses(workspace_id, criado_em desc);

create table public.experimentos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hipotese_id uuid references public.hipoteses(id) on delete set null,
  nome text not null check (char_length(nome) between 1 and 160),
  produto_id uuid references public.produtos(id) on delete set null,
  criativo_a uuid references public.criativos(id) on delete set null,
  criativo_b uuid references public.criativos(id) on delete set null,
  plataforma text check (plataforma in ('google_ads','facebook','tiktok')),
  metrica text not null default 'ctr' check (metrica in ('ctr','cpc','conversoes','whatsapp','vendas')),
  inicio date not null default current_date,
  fim date,
  status text not null default 'rodando' check (status in ('planejado','rodando','concluido','cancelado')),
  -- Resultados digitados por uma pessoa a partir dos números reais da plataforma.
  resultado_a numeric(14,4),
  resultado_b numeric(14,4),
  vencedor text check (vencedor in ('a','b','empate')),
  conclusao text check (char_length(conclusao) <= 1000),
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null
);
create index experimentos_ws_idx on public.experimentos(workspace_id, criado_em desc);

-- Memória do que funcionou (e do que não funcionou). O Diretor consulta antes de recomendar.
create table public.aprendizados (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  experimento_id uuid references public.experimentos(id) on delete set null,
  categoria text not null default 'criativo' check (categoria in ('criativo','publico','oferta','canal','site','outro')),
  texto text not null check (char_length(texto) between 1 and 1000),
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null
);
create index aprendizados_ws_idx on public.aprendizados(workspace_id, criado_em desc);

do $$
declare t text;
begin
  foreach t in array array['produtos','criativos','hipoteses','experimentos','aprendizados'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy "membros leem" on public.%I for select to authenticated using ((select private.is_member(workspace_id)))', t);
    execute format('create policy "dono ou admin cria" on public.%I for insert to authenticated with check ((select private.has_role(workspace_id, array[''owner'',''admin''])))', t);
    execute format('create policy "dono ou admin altera" on public.%I for update to authenticated using ((select private.has_role(workspace_id, array[''owner'',''admin'']))) with check ((select private.has_role(workspace_id, array[''owner'',''admin''])))', t);
    execute format('create policy "dono ou admin apaga" on public.%I for delete to authenticated using ((select private.has_role(workspace_id, array[''owner'',''admin''])))', t);
  end loop;
end $$;
