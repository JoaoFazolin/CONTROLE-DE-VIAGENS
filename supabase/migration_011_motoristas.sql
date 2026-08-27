-- ============================================================
-- MIGRACAO 011 — Cadastro de Motoristas
-- Rode este script no SQL Editor do Supabase.
--
-- Cria um cadastro de motoristas — igual já existe pra Equipamentos e
-- Obras. Antes, "Operador/Motorista" era um campo de texto livre, onde
-- cada um digitava o nome do jeito que quisesse (podendo sair digitado
-- diferente em cada lançamento). Agora vira uma lista pra selecionar.
--
-- IMPORTANTE: o campo "operador" que já existe em lancamentos e
-- lancamentos_oleo continua sendo TEXTO simples (não muda a estrutura
-- da tabela nem quebra nada do que já foi lançado antes) — só passa a
-- ser preenchido escolhendo um nome da lista, em vez de digitado à mão.
-- ============================================================

create table if not exists motoristas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now()
);

alter table motoristas enable row level security;
