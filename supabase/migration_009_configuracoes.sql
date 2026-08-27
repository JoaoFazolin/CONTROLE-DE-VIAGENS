-- ============================================================
-- MIGRACAO 009 — Configurações do sistema (obra padrão)
-- Rode este script no SQL Editor do Supabase.
--
-- Cria uma tabela genérica de configurações (chave/valor), para o
-- Administrador guardar ajustes do sistema pela própria tela do app —
-- a primeira delas é a "obra padrão", usada automaticamente nos
-- lançamentos feitos pelo Operador (que não escolhe mais a obra na
-- tela dele).
-- ============================================================

create table if not exists configuracoes (
  chave text primary key,
  valor text,
  atualizado_por uuid references profiles(id),
  updated_at timestamptz not null default now()
);

alter table configuracoes enable row level security;
