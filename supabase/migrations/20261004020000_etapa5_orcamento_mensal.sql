-- Etapa 5: orçamento mensal máximo e variação por ajuste reduzida para 10%.
-- NÃO APLICADA. Escrita no modo autônomo; o Jackson revisa e aplica (ver docs/PENDENTE.md).
-- Não apaga dados. Só APERTA os freios (nunca afrouxa).

-- 1) Nova chave de limite: orcamento_mensal_max (teto de gasto do workspace no mês).
alter table public.trafego_config drop constraint if exists trafego_config_chave_check;
alter table public.trafego_config add constraint trafego_config_chave_check
  check (chave in ('orcamento_max_sem_aprovacao','aumento_max_por_vez_percent','custos_percent','orcamento_mensal_max'));

-- 2) Todo workspace existente ganha o teto mensal padrão de R$ 2.000.
insert into public.trafego_config (workspace_id, chave, valor)
  select w.id, 'orcamento_mensal_max', 2000 from public.workspaces w
on conflict do nothing;

-- 3) Variação máxima por ajuste: o padrão antigo era 50%. Quem ainda está no padrão antigo passa para 10%.
--    Quem já escolheu outro valor na tela Limites da IA não é alterado.
update public.trafego_config set valor = 10, atualizado_em = now()
  where chave = 'aumento_max_por_vez_percent' and valor = 50;

-- 4) Workspaces novos já nascem com os padrões novos.
create or replace function private.config_padrao()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.trafego_config (workspace_id, chave, valor) values
    (new.id, 'orcamento_max_sem_aprovacao', 100),
    (new.id, 'aumento_max_por_vez_percent', 10),
    (new.id, 'custos_percent', 25),
    (new.id, 'orcamento_mensal_max', 2000)
  on conflict do nothing;
  return new;
end; $$;
revoke execute on function private.config_padrao() from public, anon, authenticated;
