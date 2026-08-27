-- ============================================================
-- MIGRACAO 006 — Só usamos Diesel: remove Gasolina e Álcool
-- Rode este script no SQL Editor do Supabase.
--
-- Por segurança, o script NÃO apaga Gasolina/Álcool se algum
-- lançamento, entrada ou equipamento já estiver usando um dos dois —
-- isso evitaria perder histórico. Nesse caso, ele só avisa (mensagem
-- "NOTICE" no resultado) e não muda nada; veja o comentário no final
-- para o passo manual, se quiser mesmo assim.
-- ============================================================

do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from tipos_combustivel where nome in ('Gasolina', 'Álcool', 'Alcool');

  if v_ids is null then
    raise notice 'Gasolina/Álcool já não existem no cadastro — nada a fazer.';
    return;
  end if;

  if exists (select 1 from lancamentos where tipo_combustivel_id = any(v_ids))
     or exists (select 1 from entradas_combustivel where tipo_combustivel_id = any(v_ids))
     or exists (select 1 from equipamentos where tipo_combustivel_id = any(v_ids)) then
    raise notice 'Gasolina e/ou Álcool já foram usados em algum lançamento, entrada ou equipamento — NÃO foram removidos automaticamente, para não perder histórico. Veja o comentário no final deste arquivo para remover manualmente, se ainda assim quiser.';
  else
    delete from tipos_combustivel where id = any(v_ids);
    raise notice 'Gasolina e Álcool removidos com sucesso — agora só resta Diesel.';
  end if;
end $$;

-- ============================================================
-- Passo manual, SÓ SE o aviso acima disse que não removeu por já
-- estarem em uso: primeiro reatribua os registros para Diesel, e
-- SÓ DEPOIS rode o delete.
--
--   update lancamentos set tipo_combustivel_id =
--     (select id from tipos_combustivel where nome = 'Diesel')
--     where tipo_combustivel_id in
--       (select id from tipos_combustivel where nome in ('Gasolina','Álcool'));
--
--   update entradas_combustivel set tipo_combustivel_id =
--     (select id from tipos_combustivel where nome = 'Diesel')
--     where tipo_combustivel_id in
--       (select id from tipos_combustivel where nome in ('Gasolina','Álcool'));
--
--   update equipamentos set tipo_combustivel_id =
--     (select id from tipos_combustivel where nome = 'Diesel')
--     where tipo_combustivel_id in
--       (select id from tipos_combustivel where nome in ('Gasolina','Álcool'));
--
--   delete from tipos_combustivel where nome in ('Gasolina', 'Álcool');
-- ============================================================
