-- Fase 2a: cadastro somente por convite
-- Já aplicada no projeto Supabase "JUDITE". Guardada aqui como registro.
create table public.convites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role text not null default 'member' check (role in ('admin','member')),
  convidado_por uuid not null default auth.uid() references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  aceito_em timestamptz,
  unique (workspace_id, email)
);
create index convites_email_idx on public.convites(email) where aceito_em is null;

alter table public.convites enable row level security;
revoke all on public.convites from anon;

create policy "dono ou admin ve convites" on public.convites
  for select to authenticated using ((select private.has_role(workspace_id, array['owner','admin'])));
create policy "dono ou admin convida" on public.convites
  for insert to authenticated with check (
    (select private.has_role(workspace_id, array['owner','admin']))
    and convidado_por = (select auth.uid()) and aceito_em is null);
create policy "dono ou admin cancela convite" on public.convites
  for delete to authenticated using ((select private.has_role(workspace_id, array['owner','admin'])) and aceito_em is null);

-- Bloqueia no banco qualquer cadastro sem convite pendente
create or replace function private.exigir_convite()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  if not exists (select 1 from public.convites c where c.email = lower(new.email) and c.aceito_em is null) then
    raise exception 'cadastro somente por convite' using errcode = 'P0001';
  end if;
  return new;
end; $$;

-- Ao criar o usuário convidado, ele entra nos workspaces que o convidaram
create or replace function private.aceitar_convites()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.members (workspace_id, user_id, role)
    select c.workspace_id, new.id, c.role from public.convites c
    where c.email = lower(new.email) and c.aceito_em is null
  on conflict (workspace_id, user_id) do nothing;
  update public.convites set aceito_em = now() where email = lower(new.email) and aceito_em is null;
  return new;
end; $$;

revoke execute on function private.exigir_convite(), private.aceitar_convites() from public, anon, authenticated;

create trigger exigir_convite before insert on auth.users
  for each row execute function private.exigir_convite();
create trigger aceitar_convites after insert on auth.users
  for each row execute function private.aceitar_convites();
