-- Etapa 10: autonomia supervisionada.
-- NÃO APLICADA. Escrita no modo autônomo; o Jackson revisa e aplica (ver docs/PENDENTE.md).
-- A autonomia começa DESLIGADA em todo workspace: sem linha nesta tabela = desligada.
-- Só o servidor grava (ligar: só o dono; "Parar tudo": dono ou admin).

create table public.autonomia (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  ligada boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  -- Última vez que foi ligada e desligada, para o histórico da tela.
  ligada_em timestamptz,
  desligada_em timestamptz
);

alter table public.autonomia enable row level security;
revoke all on public.autonomia from anon;

create policy "membros veem a autonomia" on public.autonomia
  for select to authenticated using ((select private.is_member(workspace_id)));
-- Sem política de escrita: só o servidor grava, depois de conferir o papel de quem pediu.
