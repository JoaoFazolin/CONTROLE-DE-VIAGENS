-- ============================================================
-- MIGRACAO 007 — Proteção contra lançamento duplicado
-- Rode este script no SQL Editor do Supabase.
--
-- Por que isso é necessário: o app tem um tempo limite de espera (12s)
-- para cada envio, pensado para não travar em conexão ruim (comum em
-- obra). Mas existe um caso raro: se a internet for lenta o bastante
-- pra estourar esse tempo limite DEPOIS que o servidor já salvou o
-- lançamento, o app tentaria enviar de novo mais tarde (pela fila
-- offline) — o que criaria um lançamento duplicado.
--
-- Esta migração adiciona uma "impressão digital" (client_ref) gerada
-- no próprio celular no momento em que a pessoa aperta "Salvar". Se o
-- mesmo lançamento tentar ser enviado de novo (com a mesma impressão
-- digital), o servidor reconhece e NÃO duplica — devolve o que já
-- tinha sido salvo antes.
-- ============================================================

alter table lancamentos add column if not exists client_ref text;
alter table lancamentos_oleo add column if not exists client_ref text;
alter table entradas_combustivel add column if not exists client_ref text;
alter table entradas_oleo add column if not exists client_ref text;

-- Único, mas permite muitos valores NULL (registros antigos, de antes
-- desta migração, continuam com client_ref vazio sem problema).
alter table lancamentos drop constraint if exists lancamentos_client_ref_key;
alter table lancamentos add constraint lancamentos_client_ref_key unique (client_ref);

alter table lancamentos_oleo drop constraint if exists lancamentos_oleo_client_ref_key;
alter table lancamentos_oleo add constraint lancamentos_oleo_client_ref_key unique (client_ref);

alter table entradas_combustivel drop constraint if exists entradas_combustivel_client_ref_key;
alter table entradas_combustivel add constraint entradas_combustivel_client_ref_key unique (client_ref);

alter table entradas_oleo drop constraint if exists entradas_oleo_client_ref_key;
alter table entradas_oleo add constraint entradas_oleo_client_ref_key unique (client_ref);
