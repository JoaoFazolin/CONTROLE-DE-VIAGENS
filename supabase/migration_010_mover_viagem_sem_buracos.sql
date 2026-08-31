-- ============================================================================
-- Migração 010 — LR Controle de Viagens
-- Rode no SQL Editor do Supabase DEPOIS da migração 009.
-- Não apaga nem altera nenhum dado existente.
--
-- O que muda:
-- Corrigir a DATA de uma viagem pelo PUT de /api/viagens (ex: motorista
-- lançou com o aparelho na data errada, admin corrige depois) trocava só a
-- coluna com um UPDATE direto — sem travar nada nem renumerar nada. Isso
-- deixava um buraco permanente na Ordem do dia de ORIGEM (o mesmo problema
-- que a migration_009 resolveu pra exclusão, mas continuava acontecendo
-- aqui), e podia até deixar a viagem "carregando" pro dia novo uma Ordem
-- que não fazia sentido lá (ex: Ordem 5 chegando num dia que só tinha
-- 1,2,3 — sem colidir com o unique, mas deixando um buraco no 4).
--
-- Agora o backend chama mover_viagem_e_renumerar() sempre que o PUT muda a
-- data: ela trava os DOIS dias envolvidos (nessa ordem: hash menor
-- primeiro, pra nunca dar deadlock com um movimento na direção oposta
-- acontecendo ao mesmo tempo), entra no FIM do dia novo (mesmo critério do
-- criar_viagem — não deixa buraco lá) e fecha o buraco que sobrou no dia
-- antigo.
-- ============================================================================

create or replace function public.mover_viagem_e_renumerar(p_id uuid, p_nova_data date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data_antiga date;
  v_hash_antigo integer;
  v_hash_novo   integer;
  v_nova_ordem  integer;
begin
  -- "FOR UPDATE": mesmo motivo do excluir_viagem_e_renumerar (migration
  -- 009) — trava a linha antes de decidir quais dias mexer, fechando a
  -- mesma corrida na direção contrária (uma exclusão concorrente dessa
  -- mesma viagem espera essa transação terminar, em vez de ver uma data já
  -- desatualizada).
  select data into v_data_antiga from public.viagens where id = p_id for update;
  if v_data_antiga is null then
    raise exception 'viagem_nao_encontrada';
  end if;

  if v_data_antiga = p_nova_data then
    return; -- não mudou de dia — nada a mover nem renumerar
  end if;

  v_hash_antigo := hashtext(v_data_antiga::text);
  v_hash_novo := hashtext(p_nova_data::text);

  if v_hash_antigo <= v_hash_novo then
    perform pg_advisory_xact_lock(v_hash_antigo);
    if v_hash_novo <> v_hash_antigo then
      perform pg_advisory_xact_lock(v_hash_novo);
    end if;
  else
    perform pg_advisory_xact_lock(v_hash_novo);
    perform pg_advisory_xact_lock(v_hash_antigo);
  end if;

  select coalesce(max(ordem), 0) + 1 into v_nova_ordem
  from public.viagens where data = p_nova_data;

  update public.viagens set data = p_nova_data, ordem = v_nova_ordem where id = p_id;

  with renumeradas as (
    select id, row_number() over (order by ordem asc) as nova_ordem
    from public.viagens where data = v_data_antiga
  )
  update public.viagens v set ordem = v.ordem + 1000000
  from renumeradas r where v.id = r.id;

  with renumeradas as (
    select id, row_number() over (order by ordem asc) as nova_ordem
    from public.viagens where data = v_data_antiga
  )
  update public.viagens v set ordem = r.nova_ordem
  from renumeradas r where v.id = r.id;
end;
$$;

revoke all on function public.mover_viagem_e_renumerar from public;
grant execute on function public.mover_viagem_e_renumerar to service_role;
