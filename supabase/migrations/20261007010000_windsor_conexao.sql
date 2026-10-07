-- Windsor.ai como conexão opcional por workspace (chave de API da própria empresa).
-- APLICADA no banco JUDITE em 07/10/2026, a pedido do Jackson. Guardada aqui como registro.
-- Só amplia a lista de provedores aceitos na tabela conexoes; não apaga nem altera nenhum dado.
--
-- A chave fica na coluna "segredo", criptografada pelo servidor (AES-256-GCM), como os outros tokens.
-- Em "dados" ficam só as listas de contas, as contas escolhidas e a fonte de cada plataforma
-- ("propria" ou "windsor"); nada disso é secreto. RLS e permissões da tabela continuam iguais:
-- membros leem o status, e só o servidor grava, depois de confirmar que quem pediu é o dono.

alter table public.conexoes drop constraint if exists conexoes_provedor_check;
alter table public.conexoes add constraint conexoes_provedor_check
  check (provedor in ('google_ads','meta','tiktok','google_presenca','windsor'));
