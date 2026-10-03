-- Corrige: admin não pode rebaixar/remover o dono nem promover alguém a admin.
-- O dono gerencia todos (exceto outro dono); o admin só gerencia membros comuns.
-- Já aplicada no projeto Supabase "JUDITE". Guardada aqui como registro.
alter policy "dono ou admin adiciona" on public.members
  with check (
    role <> 'owner' and (
      (select private.has_role(workspace_id, array['owner']))
      or ((select private.has_role(workspace_id, array['admin'])) and role = 'member')));

alter policy "dono ou admin altera" on public.members
  using (
    role <> 'owner' and (
      (select private.has_role(workspace_id, array['owner']))
      or ((select private.has_role(workspace_id, array['admin'])) and role = 'member')))
  with check (
    role <> 'owner' and (
      (select private.has_role(workspace_id, array['owner']))
      or ((select private.has_role(workspace_id, array['admin'])) and role = 'member')));

alter policy "dono ou admin remove" on public.members
  using (
    role <> 'owner' and (
      (select private.has_role(workspace_id, array['owner']))
      or ((select private.has_role(workspace_id, array['admin'])) and role = 'member')));

-- Convites: só o dono convida admins; admin convida apenas membros comuns.
alter policy "dono ou admin convida" on public.convites
  with check (
    convidado_por = (select auth.uid()) and aceito_em is null and (
      (select private.has_role(workspace_id, array['owner']))
      or ((select private.has_role(workspace_id, array['admin'])) and role = 'member')));
