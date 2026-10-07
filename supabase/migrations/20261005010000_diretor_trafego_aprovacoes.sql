-- Diretor de Tráfego: fila de aprovações.
-- NÃO APLICADA. O Jackson revisa e aplica (ver docs/PENDENTE.md).
--
-- As ações que a autonomia quis fazer mas passaram de algum limite ficam em trafego_acoes como
-- 'aguardando_aprovacao'. Esta migração acrescenta os dois desfechos que a tela nova grava quando
-- uma pessoa decide: 'aprovada' (a mudança é aplicada em seguida, em outra linha do histórico)
-- e 'dispensada' (nada é feito). Só amplia a lista de valores aceitos; não apaga nem altera dados.
-- A escrita continua só pelo servidor (sem política de escrita para usuários).

alter table public.trafego_acoes drop constraint if exists trafego_acoes_status_check;
alter table public.trafego_acoes add constraint trafego_acoes_status_check
  check (status in ('aplicada','erro','aguardando_aprovacao','aprovada','dispensada'));
