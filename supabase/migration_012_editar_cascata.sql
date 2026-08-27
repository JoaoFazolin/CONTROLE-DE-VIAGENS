-- ============================================================
-- MIGRACAO 012 — Editar lançamento com atualização em cascata
-- Rode este script no SQL Editor do Supabase.
--
-- Hoje, editar o Marcador Inicial ou os Litros de um lançamento no meio
-- da lista só corrige aquele lançamento — os seguintes continuam com o
-- valor antigo, quebrando a corrente (foi o que aconteceu naquele caso
-- que corrigimos manualmente antes).
--
-- Esta função resolve isso: ao editar um lançamento, ela recalcula
-- automaticamente TODOS os lançamentos seguintes (em ordem de data),
-- encadeando o Marcador Final de um como o Marcador Inicial do próximo
-- — tudo dentro de uma trava (igual já fizemos para novos lançamentos),
-- para nunca quebrar mesmo se outro lançamento estiver sendo criado ao
-- mesmo tempo.
-- ============================================================

create or replace function editar_lancamento_combustivel_cascata(
  p_id uuid,
  p_data date,
  p_hora text,
  p_operador text,
  p_obra_id uuid,
  p_equipamento_id uuid,
  p_tipo_combustivel_id uuid,
  p_marcador_inicial numeric,
  p_litros numeric,
  p_km_hora numeric,
  p_atualizado_por uuid
) returns setof lancamentos
language plpgsql
as $$
declare
  v_marcador_final numeric;
  v_atual lancamentos;
  v_prev_final numeric;
  v_rec lancamentos;
begin
  -- mesma trava usada ao criar um lançamento novo — impede qualquer
  -- outro lançamento (novo ou editado) de calcular marcador ao mesmo
  -- tempo, evitando corrida entre os dois.
  perform pg_advisory_xact_lock(hashtext('marcador_combustivel'));

  if p_marcador_inicial is not null then
    v_marcador_final := round((p_marcador_inicial + p_litros)::numeric, 2);
  else
    v_marcador_final := null;
  end if;

  update lancamentos set
    data = p_data,
    hora = p_hora,
    operador = p_operador,
    obra_id = p_obra_id,
    equipamento_id = p_equipamento_id,
    tipo_combustivel_id = p_tipo_combustivel_id,
    marcador_inicial = p_marcador_inicial,
    marcador_final = v_marcador_final,
    litros = p_litros,
    km_hora = p_km_hora,
    atualizado_por = p_atualizado_por
  where id = p_id
  returning * into v_atual;

  if not found then
    raise exception 'Lançamento não encontrado.';
  end if;

  return next v_atual;

  -- cascata: percorre TODOS os lançamentos que vêm depois deste (por
  -- data e depois por horário de criação, para desempate), na ordem, e
  -- recalcula o marcador de cada um a partir do anterior. Isso também
  -- "cura" sozinho qualquer lançamento seguinte que já estivesse com o
  -- marcador quebrado (nulo).
  v_prev_final := v_marcador_final;
  for v_rec in
    select * from lancamentos
    where (data, created_at) > (v_atual.data, v_atual.created_at)
    order by data asc, created_at asc
  loop
    if v_prev_final is null then
      -- o lançamento editado ficou sem marcador — não dá pra continuar
      -- a corrente a partir daqui, então para (não mexe no restante).
      exit;
    end if;
    update lancamentos
      set marcador_inicial = v_prev_final,
          marcador_final = round((v_prev_final + v_rec.litros)::numeric, 2)
      where id = v_rec.id
      returning * into v_rec;
    return next v_rec;
    v_prev_final := v_rec.marcador_final;
  end loop;
end;
$$;
