-- ============================================================================
-- Migração 005 — LR Controle de Viagens
-- Rode no SQL Editor do Supabase DEPOIS das migrações anteriores.
-- Não apaga nem altera nenhum dado existente.
--
-- O que muda (parte de uma rodada de correção de bugs encontrados em
-- revisão do sistema):
--
-- 1. criar_viagem(): a trava do dia (pg_advisory_xact_lock) passa a rodar
--    ANTES da checagem de "esse client_uuid já existe", não depois. Do jeito
--    que estava, duas chamadas quase simultâneas com o mesmo client_uuid
--    (reenvio da fila offline do app depois de uma resposta perdida na
--    rede, por exemplo) podiam as duas passar pela checagem "ainda não
--    existe" antes de qualquer uma inserir — a segunda batia na unique
--    constraint de client_uuid e devolvia um erro 500 pro app, em vez de
--    devolver o registro que a primeira já tinha gravado (que é o
--    comportamento que a fila offline depende pra funcionar direito).
--
-- 2. Novos índices em viagens.caminhao_id e viagens.destino_id — os
--    relatórios (Excel/PDF) e o histórico filtram por essas colunas o
--    tempo todo, e só existiam índices em "data" e "motorista_id".
-- ============================================================================

create index if not exists idx_viagens_caminhao on public.viagens (caminhao_id);
create index if not exists idx_viagens_destino on public.viagens (destino_id);

create or replace function public.criar_viagem(
  p_client_uuid     uuid,
  p_data            date,
  p_caminhao_id     uuid,
  p_escavadeira_id  uuid,
  p_local_carga_id  uuid,
  p_destino_id      uuid,
  p_total_viagens   integer,
  p_diesel_litros   numeric,
  p_motorista_id    uuid,
  p_registrado_em   timestamptz,
  p_criado_por      uuid
)
returns public.viagens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ordem   integer;
  v_row     public.viagens;
begin
  -- Trava exclusiva para este dia ANTES de checar duplicidade (ver
  -- explicação no cabeçalho desta migração).
  perform pg_advisory_xact_lock(hashtext(p_data::text));

  -- Se esse client_uuid já foi gravado antes (reenvio da fila offline),
  -- devolve o registro existente em vez de duplicar.
  select * into v_row from public.viagens where client_uuid = p_client_uuid;
  if found then
    return v_row;
  end if;

  select coalesce(max(ordem), 0) + 1 into v_ordem
  from public.viagens
  where data = p_data;

  insert into public.viagens (
    client_uuid, data, ordem, caminhao_id, escavadeira_id, local_carga_id,
    destino_id, total_viagens, diesel_litros, motorista_id, registrado_em, criado_por
  ) values (
    p_client_uuid, p_data, v_ordem, p_caminhao_id, p_escavadeira_id, p_local_carga_id,
    p_destino_id, p_total_viagens, p_diesel_litros, p_motorista_id, p_registrado_em, p_criado_por
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.criar_viagem from public;
grant execute on function public.criar_viagem to service_role;
