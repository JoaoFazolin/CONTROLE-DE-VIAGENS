-- ============================================================
-- MIGRACAO 002 — Estoque de combustivel + Login individual
-- Rode este script no SQL Editor do Supabase DEPOIS do schema.sql
-- (ele nao apaga nada que ja existe, so adiciona)
-- ============================================================

-- ---------- Perfis de usuario (login individual) ----------
-- Cada usuario e criado em Authentication > Users no Supabase,
-- e precisa de uma linha correspondente aqui com o papel dele.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  role text not null default 'operador' check (role in ('admin', 'operador')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
-- sem policy publica: so a service_role (Netlify Functions) acessa

-- ---------- Tipos de combustivel ----------
create table if not exists tipos_combustivel (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  estoque_minimo numeric not null default 0,
  created_at timestamptz not null default now()
);

insert into tipos_combustivel (nome, estoque_minimo)
values ('Diesel', 500), ('Álcool', 200), ('Gasolina', 200)
on conflict (nome) do nothing;

alter table tipos_combustivel enable row level security;

-- ---------- Entradas de combustivel (chegada do comboio) ----------
create table if not exists entradas_combustivel (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  tipo_combustivel_id uuid references tipos_combustivel(id),
  litros numeric not null,
  fornecedor text,
  nota_fiscal text,
  observacao text,
  criado_por uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_entradas_data on entradas_combustivel(data);
create index if not exists idx_entradas_tipo on entradas_combustivel(tipo_combustivel_id);

alter table entradas_combustivel enable row level security;

-- ---------- Ajustes nas tabelas existentes ----------

-- cada equipamento pode ter um tipo de combustivel padrao
alter table equipamentos add column if not exists tipo_combustivel_id uuid references tipos_combustivel(id);

-- cada lancamento (saida) agora registra qual combustivel foi usado,
-- para poder dar baixa no estoque certo
alter table lancamentos add column if not exists tipo_combustivel_id uuid references tipos_combustivel(id);

-- rastreabilidade: quem criou / quem editou por ultimo
alter table lancamentos add column if not exists criado_por uuid references profiles(id);
alter table lancamentos add column if not exists atualizado_por uuid references profiles(id);

-- ============================================================
-- Depois de rodar este script:
-- 1. Va em Authentication > Users no Supabase e crie o primeiro
--    usuario (seu e-mail e uma senha).
-- 2. Volte aqui no SQL Editor e rode (trocando o e-mail):
--
--    insert into profiles (id, nome, role)
--    select id, 'Seu Nome', 'admin' from auth.users
--    where email = 'seuemail@exemplo.com';
--
-- Isso te torna administrador do sistema. Os demais operadores
-- podem ser criados depois direto pela tela "Usuarios" do app.
-- ============================================================
