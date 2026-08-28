-- Migração 003: volume de cada caminhão, usado no relatório Excel (aba
-- "Resumo do dia") pra calcular o volume total transportado por viagem.
-- Os três valores são digitados manualmente pelo admin no cadastro do
-- caminhão (não são calculados pelo sistema, pra não arriscar errar a
-- fórmula de empolamento/compactação usada pela obra) — rode depois da
-- migration_002_vinculo_motorista_caminhao.sql.

alter table public.caminhoes
  add column if not exists volume numeric,
  add column if not exists volume_empolamento numeric,
  add column if not exists volume_aterro numeric;

comment on column public.caminhoes.volume is 'Volume do caminhão (m³), digitado pelo admin.';
comment on column public.caminhoes.volume_empolamento is 'Volume com empolamento (m³), digitado pelo admin.';
comment on column public.caminhoes.volume_aterro is 'Volume no aterro (m³) — usado no relatório como "volume por viagem" desse caminhão.';
