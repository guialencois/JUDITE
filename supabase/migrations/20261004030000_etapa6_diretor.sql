-- Etapa 6: Diretor v1 (relatórios diários e recomendações).
-- NÃO APLICADA. Escrita no modo autônomo; o Jackson revisa e aplica (ver docs/PENDENTE.md).
-- Leitura: só membros do workspace. Escrita: só o servidor (service role), depois de checar quem pediu.

create table public.diretor_relatorios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dia date not null,
  criado_em timestamptz not null default now(),
  origem text not null default 'manual' check (origem in ('cron','manual')),
  criado_por uuid references auth.users(id) on delete set null,
  modelo text,
  status text not null default 'ok' check (status in ('ok','erro')),
  erro text check (char_length(erro) <= 500),
  -- Resumo dos dados enviado à IA (só números agregados; nenhum dado pessoal).
  resumo jsonb not null default '{}'::jsonb,
  diagnostico text check (char_length(diagnostico) <= 6000),
  pontos jsonb not null default '[]'::jsonb,
  -- Recomendações que a IA propôs e as regras de prudência barraram, com o motivo.
  descartadas jsonb not null default '[]'::jsonb,
  tokens_entrada integer,
  tokens_saida integer
);
create index diretor_relatorios_ws_idx on public.diretor_relatorios(workspace_id, criado_em desc);

create table public.diretor_recomendacoes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  relatorio_id uuid not null references public.diretor_relatorios(id) on delete cascade,
  criado_em timestamptz not null default now(),
  ordem integer not null default 0,
  tipo text not null check (tipo in ('pausar_campanha','ativar_campanha','ajustar_orcamento','criativo','site','perfil_google','seo','comercial','outro')),
  titulo text not null check (char_length(titulo) between 1 and 200),
  justificativa text not null check (char_length(justificativa) <= 2000),
  impacto_esperado text check (char_length(impacto_esperado) <= 1000),
  prioridade text not null default 'media' check (prioridade in ('alta','media','baixa')),
  plataforma text check (plataforma in ('google_ads','facebook','tiktok')),
  campanha_id text check (char_length(campanha_id) <= 64),
  valor_sugerido numeric(14,2) check (valor_sugerido is null or valor_sugerido > 0),
  status text not null default 'proposta' check (status in ('proposta','aprovada','recusada','executada')),
  decidido_por uuid references auth.users(id) on delete set null,
  decidido_em timestamptz,
  resultado text check (char_length(resultado) <= 500)
);
create index diretor_recomendacoes_ws_idx on public.diretor_recomendacoes(workspace_id, criado_em desc);
create index diretor_recomendacoes_relatorio_idx on public.diretor_recomendacoes(relatorio_id);

alter table public.diretor_relatorios enable row level security;
alter table public.diretor_recomendacoes enable row level security;
revoke all on public.diretor_relatorios, public.diretor_recomendacoes from anon;

create policy "membros leem relatorios" on public.diretor_relatorios
  for select to authenticated using ((select private.is_member(workspace_id)));
create policy "membros leem recomendacoes" on public.diretor_recomendacoes
  for select to authenticated using ((select private.is_member(workspace_id)));
-- Sem política de escrita: só o servidor grava (gerar relatório, aprovar, recusar),
-- depois de confirmar que quem pediu é dono ou admin do workspace.
