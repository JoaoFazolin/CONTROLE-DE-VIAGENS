-- ============================================================
-- MIGRACAO 005 — Controle de Óleo Lubrificante
-- Rode este script no SQL Editor do Supabase.
--
-- Cria um módulo paralelo ao de combustível, só que mais simples:
-- lançamento de óleo NÃO tem marcador inicial/final (só a
-- quantidade usada), e essa quantidade abate do estoque de óleo
-- (alimentado pela tela de Entrada de Óleo).
--
-- Segue o mesmo padrão de segurança das tabelas de combustível:
-- RLS ligado e SEM políticas — só a service role (usada pelas
-- Netlify Functions) acessa. Isso é intencional, não um esquecimento.
-- ============================================================

create table if not exists tipos_oleo (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  estoque_minimo numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists entradas_oleo (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  tipo_oleo_id uuid references tipos_oleo(id),
  litros numeric not null,
  fornecedor text,
  nota_fiscal text,
  observacao text,
  criado_por uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists lancamentos_oleo (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  operador text not null,
  obra_id uuid references obras(id) on delete set null,
  equipamento_id uuid references equipamentos(id) on delete set null,
  tipo_oleo_id uuid references tipos_oleo(id),
  litros numeric not null,
  criado_por uuid references profiles(id),
  atualizado_por uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table tipos_oleo enable row level security;
alter table entradas_oleo enable row level security;
alter table lancamentos_oleo enable row level security;

-- Semente inicial (só roda se a tabela estiver vazia). Renomeie ou
-- adicione outros tipos depois direto pelo SQL Editor, se quiser:
--   insert into tipos_oleo (nome, estoque_minimo) values ('Nome do óleo', 20);
insert into tipos_oleo (nome, estoque_minimo)
select v.nome, v.estoque_minimo from (
  values ('Óleo Motor 15W40', 20::numeric), ('Óleo Hidráulico', 20::numeric)
) as v(nome, estoque_minimo)
where not exists (select 1 from tipos_oleo);
