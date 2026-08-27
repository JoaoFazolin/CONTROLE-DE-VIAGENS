-- ============================================================
-- MIGRACAO 003 — Novo papel "Operador Avançado"
-- Rode este script no SQL Editor do Supabase DEPOIS das migracoes
-- 001/002 (ele nao apaga nada que ja existe, so adiciona a opcao).
--
-- Papeis apos esta migracao:
--   operador          -> só lança abastecimento; só edita o que
--                        ele mesmo registrou; sem acesso a
--                        Equipamentos, Obras, Relatório, Dashboard,
--                        Usuários nem a Registrar Entrada de estoque.
--   operador_avancado -> acesso igual ao administrador em TODOS os
--                        módulos, EXCETO a tela de Usuários.
--   admin             -> acesso completo, incluindo Usuários.
-- ============================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'operador', 'operador_avancado'));

-- Para promover alguém a Operador Avançado direto pelo SQL Editor
-- (ou use a tela "Usuários" no app, que já tem a opção nova):
--
--   update profiles set role = 'operador_avancado'
--   where id = (select id from auth.users where email = 'email@exemplo.com');
