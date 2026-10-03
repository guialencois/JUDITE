-- Fase 1: workspaces e membros, com isolamento por RLS.
-- Já aplicada no projeto Supabase "JUDITE" (xarkssppkntqlkwwclmf). Guardada aqui como registro.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index members_user_id_idx on public.members(user_id);

create or replace function private.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.members m where m.workspace_id = ws and m.user_id = (select auth.uid())); $$;

create or replace function private.has_role(ws uuid, roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.members m where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = any(roles)); $$;

grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid), private.has_role(uuid, text[]) to authenticated;

create or replace function private.add_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.members (workspace_id, user_id, role) values (new.id, new.created_by, 'owner');
  return new;
end; $$;
revoke execute on function private.add_owner() from public, anon, authenticated;

create trigger workspaces_add_owner after insert on public.workspaces
for each row execute function private.add_owner();

alter table public.workspaces enable row level security;
alter table public.members enable row level security;
revoke all on public.workspaces, public.members from anon;

create policy "membros veem o workspace" on public.workspaces
  for select to authenticated using ((select private.is_member(id)));
create policy "criador ve o workspace" on public.workspaces
  for select to authenticated using (created_by = (select auth.uid()));
create policy "usuario cria workspace proprio" on public.workspaces
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "dono ou admin edita" on public.workspaces
  for update to authenticated using ((select private.has_role(id, array['owner','admin'])))
  with check ((select private.has_role(id, array['owner','admin'])));
create policy "so dono apaga" on public.workspaces
  for delete to authenticated using ((select private.has_role(id, array['owner'])));

create policy "membros veem a equipe" on public.members
  for select to authenticated using ((select private.is_member(workspace_id)));
create policy "dono ou admin adiciona" on public.members
  for insert to authenticated with check ((select private.has_role(workspace_id, array['owner','admin'])) and role <> 'owner');
create policy "dono ou admin altera" on public.members
  for update to authenticated using ((select private.has_role(workspace_id, array['owner','admin'])))
  with check ((select private.has_role(workspace_id, array['owner','admin'])) and role <> 'owner');
create policy "dono ou admin remove" on public.members
  for delete to authenticated using ((select private.has_role(workspace_id, array['owner','admin'])) and role <> 'owner');
