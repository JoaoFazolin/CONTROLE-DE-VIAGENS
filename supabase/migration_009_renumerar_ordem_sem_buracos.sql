-- ============================================================================
-- Migração 009 — LR Controle de Viagens
-- Rode no SQL Editor do Supabase DEPOIS das migrações anteriores.
--
-- O que muda:
-- Excluir uma viagem (uso raro, só admin) tirava a linha do banco, mas os
-- lançamentos seguintes daquele dia continuavam com a Ordem antiga — ex:
-- excluir a Ordem 2 de um dia com 1,2,3,4,5 deixava 1,3,4,5 (buraco no 2),
-- confundindo quem olha o histórico. A partir de agora, toda exclusão fecha
-- esse buraco sozinha, renumerando 1..N os que sobraram daquele dia — sem
-- trocar a ORDEM relativa entre eles, só deixando a numeração contínua.
--
-- Esta migração faz duas coisas:
--   1. Cria a function excluir_viagem_e_renumerar(), que o backend passa a
--      chamar no DELETE de /api/viagens em vez de excluir a linha direto.
--      A linha é travada com "FOR UPDATE" antes de decidir qual dia mexer —
--      sem isso, uma corrida rara com mover_viagem_e_renumerar (migration
--      010, que muda a DATA de uma viagem) podia travar e renumerar o dia
--      ERRADO se as duas chamadas caíssem quase juntas na mesma viagem.
--   2. Conserta, DE UMA VEZ SÓ, os buracos que já existem hoje — mas só nos
--      dias A PARTIR DE 26/08/2026 (inclusive). Dias anteriores a essa data
--      ficam exatamente como estão, sem nenhuma linha tocada — decisão
--      explícita de não renumerar o histórico mais antigo. Essa parte roda
--      dentro de uma transação que trava TODOS os dias envolvidos (mesma
--      trava usada por criar_viagem/excluir_viagem_e_renumerar) antes de
--      tocar em qualquer linha — sem isso, rodar esta migração com o site
--      já em produção recebendo lançamentos novos podia deixar uma viagem
--      inserida bem no meio do conserto presa com uma Ordem temporária
--      (na faixa de +1.000.000) pra sempre.
--
-- Rodar de novo depois não faz mal nenhum: se não sobrar buraco nenhum a
-- partir de 26/08, a renumeração não muda nada (cada viagem já recebe o
-- mesmo número que já tinha).
-- ============================================================================

create or replace function public.excluir_viagem_e_renumerar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data date;
begin
  -- "FOR UPDATE": ver explicação no cabeçalho desta migração.
  select data into v_data from public.viagens where id = p_id for update;
  if v_data is null then
    raise exception 'viagem_nao_encontrada';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_data::text));

  delete from public.viagens where id = p_id;

  with renumeradas as (
    select id, row_number() over (order by ordem asc) as nova_ordem
    from public.viagens
    where data = v_data
  )
  update public.viagens v set ordem = v.ordem + 1000000
  from renumeradas r where v.id = r.id;

  with renumeradas as (
    select id, row_number() over (order by ordem asc) as nova_ordem
    from public.viagens
    where data = v_data
  )
  update public.viagens v set ordem = r.nova_ordem
  from renumeradas r where v.id = r.id;
end;
$$;

revoke all on function public.excluir_viagem_e_renumerar from public;
grant execute on function public.excluir_viagem_e_renumerar to service_role;

-- Conserto único dos buracos já existentes, só a partir de 26/08/2026.
-- Tudo numa única transação: primeiro trava CADA dia envolvido (mesma
-- trava por dia usada em toda escrita de viagens), só depois toca em
-- qualquer linha — assim, se um lançamento novo (criar_viagem) estiver
-- acontecendo bem nesse instante num desses dias, ou esse conserto espera
-- ele terminar, ou ele espera o conserto terminar; nunca os dois mexendo
-- ao mesmo tempo no mesmo dia.
begin;

do $$
declare
  v_data date;
begin
  for v_data in
    select distinct data from public.viagens where data >= '2026-08-26' order by data
  loop
    perform pg_advisory_xact_lock(hashtext(v_data::text));
  end loop;
end $$;

-- Mesmo truque do +1000000 de excluir_viagem_e_renumerar, aqui pra todos
-- os dias de uma vez (row_number particionado por data).
with renumeradas as (
  select id, row_number() over (partition by data order by ordem asc) as nova_ordem
  from public.viagens
  where data >= '2026-08-26'
)
update public.viagens v set ordem = v.ordem + 1000000
from renumeradas r where v.id = r.id;

with renumeradas as (
  select id, row_number() over (partition by data order by ordem asc) as nova_ordem
  from public.viagens
  where data >= '2026-08-26'
)
update public.viagens v set ordem = r.nova_ordem
from renumeradas r where v.id = r.id;

commit;
