-- ============================================================
-- MIGRACAO 008 — Hora exata do lançamento
-- Rode este script no SQL Editor do Supabase.
--
-- Adiciona uma coluna "hora" (texto, formato HH:MM) nos lançamentos de
-- combustível e óleo. Diferente do "created_at" (que é preenchido pelo
-- servidor no momento em que o dado É SALVO no banco), essa "hora" é
-- capturada no PRÓPRIO CELULAR da pessoa, no momento em que ela aperta
-- "Salvar" — então continua correta mesmo que o lançamento tenha ficado
-- horas na fila offline esperando internet antes de sincronizar.
-- ============================================================

alter table lancamentos add column if not exists hora text;
alter table lancamentos_oleo add column if not exists hora text;
