-- Etapa 4: TikTok Ads como terceira plataforma.
-- NÃO APLICADA. Escrita no modo autônomo; o Jackson revisa e aplica (ver docs/PENDENTE.md).
-- Só amplia as listas permitidas (check); não apaga nem altera nenhum dado.

alter table public.trafego_contas drop constraint if exists trafego_contas_plataforma_check;
alter table public.trafego_contas add constraint trafego_contas_plataforma_check
  check (plataforma in ('google_ads','facebook','tiktok'));

alter table public.trafego_metricas_dia drop constraint if exists trafego_metricas_dia_plataforma_check;
alter table public.trafego_metricas_dia add constraint trafego_metricas_dia_plataforma_check
  check (plataforma in ('google_ads','facebook','tiktok'));

alter table public.trafego_campanhas drop constraint if exists trafego_campanhas_plataforma_check;
alter table public.trafego_campanhas add constraint trafego_campanhas_plataforma_check
  check (plataforma in ('google_ads','facebook','tiktok'));

-- Conexões: TikTok Ads (token criptografado pelo servidor, igual às outras).
alter table public.conexoes drop constraint if exists conexoes_provedor_check;
alter table public.conexoes add constraint conexoes_provedor_check
  check (provedor in ('google_ads','meta','tiktok'));
