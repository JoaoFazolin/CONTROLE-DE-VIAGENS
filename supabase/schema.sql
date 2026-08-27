-- ============================================================
-- Controle de Abastecimento de Combustivel — Schema Supabase
-- Rode este script inteiro no SQL Editor do Supabase.
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists equipamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now()
);

create table if not exists obras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now()
);

create table if not exists lancamentos (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  operador text not null,
  obra_id uuid references obras(id) on delete set null,
  equipamento_id uuid references equipamentos(id) on delete set null,
  marcador_inicial numeric,
  marcador_final numeric,
  litros numeric not null,
  km_hora numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_lancamentos_data on lancamentos(data);
create index if not exists idx_lancamentos_equipamento on lancamentos(equipamento_id);
create index if not exists idx_lancamentos_obra on lancamentos(obra_id);

-- ============================================================
-- SEGURANCA: habilita Row Level Security e NAO cria nenhuma
-- policy publica. Isso bloqueia completamente o acesso via
-- anon key / authenticated key (usada no navegador).
-- Apenas a service_role key (usada dentro das Netlify Functions,
-- nunca exposta ao navegador) consegue ler/escrever nestas tabelas.
-- ============================================================
alter table equipamentos enable row level security;
alter table obras enable row level security;
alter table lancamentos enable row level security;

-- Nenhuma policy criada de propósito: sem policy = sem acesso via
-- chaves publicas. Nao adicione policies "for all using (true)"
-- a menos que voce queira liberar acesso direto do navegador.
