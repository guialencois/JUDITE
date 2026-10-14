-- CMO autônoma: plano de campanha, máquina de estados com histórico, ideias, ciclo diário observável,
-- níveis de autonomia e governança por canal.
-- NÃO APLICADA. O Jackson revisa e aplica (ver docs/PENDENTE.md). Depende das migrações das Etapas 5, 8, 9 e 10.
-- Não apaga nem altera dados existentes: só acrescenta colunas, tabelas e valores aceitos.
-- Tabelas novas: workspace_id, RLS ligado, leitura para membros, escrita só pelo servidor (sem política de escrita).

-- 1) Campanhas: plano completo da CMO e novos estados ------------------------------------------------
alter table public.campanha_rascunhos
  -- Estratégia, hipótese, métrica, risco, confiança, dados utilizados, palavras-chave, anúncios e etapas da geração.
  add column if not exists plano jsonb,
  -- Chave da oportunidade que originou a campanha (ex.: "intencao_de_busca"): evita proposta duplicada.
  add column if not exists oportunidade text check (char_length(oportunidade) <= 60);

alter table public.campanha_rascunhos drop constraint if exists campanha_rascunhos_status_check;
alter table public.campanha_rascunhos add constraint campanha_rascunhos_status_check
  check (status in (
    'rascunho','aguardando_aprovacao','publicada_pausada','ativa','aprendizado','otimizando',
    'pausada','pausada_pela_ia','concluida','recusada','erro'
  ));

-- 2) Histórico de cada mudança de estado (auditoria: quem, quando, de onde para onde e por quê) -----
create table public.campanha_eventos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rascunho_id uuid not null references public.campanha_rascunhos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  de text check (char_length(de) <= 30),
  para text not null check (char_length(para) <= 30),
  -- Quem causou: uma pessoa, a IA (CMO) ou o sistema (monitoramento).
  ator text not null check (ator in ('pessoa','ia','sistema')),
  usuario_id uuid references auth.users(id) on delete set null,
  motivo text check (char_length(motivo) <= 500)
);
create index campanha_eventos_rascunho_idx on public.campanha_eventos(rascunho_id, criado_em);
create index campanha_eventos_ws_idx on public.campanha_eventos(workspace_id, criado_em desc);

-- 3) Ideias de campanha ("Quero ideias") -----------------------------------------------------------
create table public.campanha_ideias (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id) on delete set null,
  produto_id uuid references public.produtos(id) on delete cascade,
  oportunidade text not null check (char_length(oportunidade) <= 60),
  plataforma text not null check (plataforma in ('google_ads','facebook','tiktok')),
  objetivo text not null check (objetivo in ('trafego','mensagens','conversoes','reconhecimento')),
  titulo text not null check (char_length(titulo) between 1 and 200),
  -- Por que, público, estratégia, hipótese, métrica, confiança e dados utilizados.
  detalhes jsonb not null default '{}'::jsonb,
  orcamento_sugerido numeric(14,2) check (orcamento_sugerido is null or orcamento_sugerido >= 0),
  status text not null default 'nova' check (status in ('nova','usada','descartada')),
  modelo text check (char_length(modelo) <= 80)
);
create index campanha_ideias_ws_idx on public.campanha_ideias(workspace_id, criado_em desc);

-- 4) Ciclo da CMO: cada execução e o resultado de cada etapa (coleta, análise, decisão, geração, fila) -
create table public.cmo_execucoes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  iniciado_em timestamptz not null default now(),
  terminado_em timestamptz,
  -- Dia (horário de Brasília) a que a execução pertence.
  dia date not null,
  origem text not null check (origem in ('cron','manual')),
  modo text not null check (modo in ('diario','automatico','guiado','ideia','ideias')),
  usuario_id uuid references auth.users(id) on delete set null,
  status text not null default 'rodando' check (status in ('rodando','ok','sem_proposta','erro')),
  etapas jsonb not null default '[]'::jsonb,
  resultado text check (char_length(resultado) <= 500),
  rascunho_id uuid references public.campanha_rascunhos(id) on delete set null
);
create index cmo_execucoes_ws_idx on public.cmo_execucoes(workspace_id, iniciado_em desc);
-- Idempotência: no máximo UM ciclo diário automático por workspace por dia, mesmo que o cron dispare duas vezes.
create unique index cmo_execucoes_diario_unico on public.cmo_execucoes(workspace_id, dia) where origem = 'cron' and modo = 'diario';

do $$
declare t text;
begin
  foreach t in array array['campanha_eventos','campanha_ideias','cmo_execucoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy "membros leem" on public.%I for select to authenticated using ((select private.is_member(workspace_id)))', t);
  end loop;
end $$;

-- 5) Níveis de autonomia -------------------------------------------------------------------------
-- 0 manual (só quando pedem) · 1 assistido (propõe todo dia e espera) · 2 controlada (ajusta verba nos limites)
-- 3 avançada · 4 CMO autônoma. Os níveis 3 e 4 existem no banco mas a aplicação ainda NÃO permite ligar.
-- A coluna "ligada" continua sendo a chave do dinheiro: nível 2 ou mais só vale com ligada = true.
alter table public.autonomia
  add column if not exists nivel smallint not null default 1 check (nivel between 0 and 4);
update public.autonomia set nivel = 2 where ligada = true and nivel < 2;

-- 6) Governança financeira: limites novos -------------------------------------------------------
alter table public.trafego_config drop constraint if exists trafego_config_chave_check;
alter table public.trafego_config add constraint trafego_config_chave_check
  check (chave in (
    'orcamento_max_sem_aprovacao','aumento_max_por_vez_percent','custos_percent','orcamento_mensal_max',
    -- maior redução de verba de uma vez sem aprovação
    'reducao_max_por_vez_percent',
    -- teto de gasto no mês por canal (0 = sem teto próprio; vale só o teto geral)
    'mensal_max_google_ads','mensal_max_facebook','mensal_max_tiktok',
    -- 1 = a JUDITE não propõe campanha nem age sozinha neste canal
    'bloqueada_google_ads','bloqueada_facebook','bloqueada_tiktok'
  ));

insert into public.trafego_config (workspace_id, chave, valor)
  select w.id, c.chave, c.valor
  from public.workspaces w
  cross join (values
    ('reducao_max_por_vez_percent', 50),
    ('mensal_max_google_ads', 0), ('mensal_max_facebook', 0), ('mensal_max_tiktok', 0),
    ('bloqueada_google_ads', 0), ('bloqueada_facebook', 0), ('bloqueada_tiktok', 0)
  ) as c(chave, valor)
on conflict do nothing;

create or replace function private.config_padrao()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.trafego_config (workspace_id, chave, valor) values
    (new.id, 'orcamento_max_sem_aprovacao', 100),
    (new.id, 'aumento_max_por_vez_percent', 10),
    (new.id, 'custos_percent', 25),
    (new.id, 'orcamento_mensal_max', 2000),
    (new.id, 'reducao_max_por_vez_percent', 50),
    (new.id, 'mensal_max_google_ads', 0), (new.id, 'mensal_max_facebook', 0), (new.id, 'mensal_max_tiktok', 0),
    (new.id, 'bloqueada_google_ads', 0), (new.id, 'bloqueada_facebook', 0), (new.id, 'bloqueada_tiktok', 0)
  on conflict do nothing;
  return new;
end; $$;
revoke execute on function private.config_padrao() from public, anon, authenticated;
