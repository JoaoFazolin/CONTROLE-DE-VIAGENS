-- ============================================================================
-- Migração 007 — LR Controle de Viagens
-- Rode no SQL Editor do Supabase DEPOIS das migrações anteriores.
-- Não apaga nem altera nenhum dado existente.
--
-- O que muda:
-- Nem criar_viagem() nem o UPDATE de /api/viagens (PUT, correção de admin)
-- checavam se o caminhão/destino/motorista/escavadeira/local de carga
-- referenciado ainda estava ATIVO — "Desativar" um cadastro só tira ele da
-- lista de opções na tela, mas o id continua existindo e válido pra chave
-- estrangeira. Como o app funciona offline (cadastros ficam em cache no
-- aparelho, e viagens não enviadas ficam na fila local esperando conexão),
-- dava pra gravar uma viagem contra um caminhão que foi desativado ENQUANTO
-- a viagem estava esperando pra sincronizar — sem erro nenhum, corrompendo
-- silenciosamente relatórios com um caminhão "fantasma".
--
-- Agora criar_viagem() recusa (com uma mensagem específica) se qualquer um
-- dos cadastros referenciados estiver desativado.
-- ============================================================================

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
  perform pg_advisory_xact_lock(hashtext(p_data::text));

  select * into v_row from public.viagens where client_uuid = p_client_uuid;
  if found then
    return v_row;
  end if;

  -- Garante que os cadastros referenciados ainda estão ativos (ver
  -- explicação no cabeçalho desta migração). Os dois obrigatórios primeiro,
  -- depois os dois opcionais (só checa se foram informados).
  if not exists (select 1 from public.caminhoes where id = p_caminhao_id and ativo) then
    raise exception 'caminhao_inativo';
  end if;
  if not exists (select 1 from public.destinos where id = p_destino_id and ativo) then
    raise exception 'destino_inativo';
  end if;
  if not exists (select 1 from public.profiles where id = p_motorista_id and ativo) then
    raise exception 'motorista_inativo';
  end if;
  if p_escavadeira_id is not null and not exists (select 1 from public.escavadeiras where id = p_escavadeira_id and ativo) then
    raise exception 'escavadeira_inativa';
  end if;
  if p_local_carga_id is not null and not exists (select 1 from public.locais_carga where id = p_local_carga_id and ativo) then
    raise exception 'local_carga_inativo';
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
