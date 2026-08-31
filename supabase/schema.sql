-- ============================================================================
-- LR Controle de Viagens — schema Supabase (Postgres)
-- Rode este arquivo inteiro no SQL Editor do Supabase (projeto novo, dedicado
-- a este sistema — separado do banco do sistema de combustível).
--
-- Segurança: RLS ativado em TODAS as tabelas e SEM políticas públicas.
-- Isso significa: ninguém consegue ler/gravar via anon key / frontend direto.
-- Só a service_role key (usada exclusivamente nas Netlify Functions) ignora
-- RLS e consegue acessar os dados. O frontend nunca fala com o Supabase.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- PERFIS (vincula 1:1 com auth.users; guarda nome e papel do usuário)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nome        text not null,
  role        text not null check (role in ('admin', 'motorista')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

alter table public.profiles enable row level security;
-- Sem políticas: só service_role acessa.

-- ----------------------------------------------------------------------------
-- CADASTROS (caminhões, escavadeiras, locais de carga, destinos)
-- ----------------------------------------------------------------------------
create table if not exists public.caminhoes (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,          -- ex: "CB 236"
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
alter table public.caminhoes enable row level security;

create table if not exists public.escavadeiras (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,          -- ex: "EH 349"
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
alter table public.escavadeiras enable row level security;

create table if not exists public.locais_carga (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,          -- ex: "Frente de Lavra 2"
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
alter table public.locais_carga enable row level security;

create table if not exists public.destinos (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,          -- ex: "AT.O", "BF.O", "AT.L"
  descricao   text,                          -- ex: "Aterro - Obra"
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
alter table public.destinos enable row level security;

-- ----------------------------------------------------------------------------
-- VIAGENS
-- ----------------------------------------------------------------------------
create table if not exists public.viagens (
  id               uuid primary key default gen_random_uuid(),
  client_uuid      uuid not null unique,     -- gerado no aparelho, evita duplicar em reenvio offline
  data             date not null,            -- dia da viagem (fuso do aparelho, decidido no frontend)
  ordem            integer not null,         -- sequencial do dia, calculado no banco (ver função abaixo)
  caminhao_id      uuid not null references public.caminhoes (id),
  escavadeira_id   uuid references public.escavadeiras (id),
  local_carga_id   uuid references public.locais_carga (id),
  destino_id       uuid not null references public.destinos (id),
  total_viagens    integer not null default 1 check (total_viagens > 0),
  diesel_litros    numeric(10, 2),
  motorista_id     uuid not null references public.profiles (id),
  registrado_em    timestamptz not null,     -- hora capturada NO APARELHO no momento de salvar
  criado_por       uuid not null references public.profiles (id), -- quem efetivamente lançou (motorista ou admin)
  sincronizado_em  timestamptz not null default now(), -- hora que chegou no servidor (referência, não usar para ordenar o dia)
  unique (data, ordem)
);
alter table public.viagens enable row level security;

create index if not exists idx_viagens_data on public.viagens (data);
create index if not exists idx_viagens_motorista on public.viagens (motorista_id);
create index if not exists idx_viagens_caminhao on public.viagens (caminhao_id);
create index if not exists idx_viagens_destino on public.viagens (destino_id);
-- criado_por é o filtro mais usado no dia a dia: todo GET de /api/viagens e
-- /api/resumo-dia feito por um Operador Avançado (quem realmente loga e
-- lança, na prática) filtra por "o que EU mesmo lancei", não por motorista.
create index if not exists idx_viagens_criado_por on public.viagens (criado_por);

-- ----------------------------------------------------------------------------
-- Sequência de "Ordem" travada com pg_advisory_xact_lock
-- Evita duas viagens do mesmo dia caírem com o mesmo número quando dois
-- lançamentos chegam ao mesmo tempo (offline sync em lote, por exemplo).
-- hashtext(data::text) dá uma chave estável e determinística por dia.
-- ----------------------------------------------------------------------------
create or replace function public.criar_viagem(
  p_client_uuid     uuid,
  p_data            date,
  p_caminhao_id     uuid,
  p_escavadeira_id  uuid,
  p_local_carga_id  uuid,
  p_destino_id      uuid,
  p_total_viagens   integer,
  p_diesel_litros   numeric,
  p_motorista_id    uuid,
  p_registrado_em   timestamptz,
  p_criado_por      uuid
)
returns public.viagens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ordem   integer;
  v_row     public.viagens;
begin
  -- Trava exclusiva para este dia ANTES de checar duplicidade (não depois):
  -- se duas chamadas com o mesmo client_uuid chegam quase juntas (reenvio
  -- da fila offline por uma resposta que se perdeu na rede, por exemplo),
  -- travar só DEPOIS da checagem deixava as duas passarem pelo "ainda não
  -- existe" antes de qualquer uma inserir — a segunda então batia na unique
  -- constraint de client_uuid e devolvia erro em vez de, como devia,
  -- simplesmente devolver o registro que a primeira já tinha gravado.
  perform pg_advisory_xact_lock(hashtext(p_data::text));

  -- Se esse client_uuid já foi gravado antes (reenvio da fila offline),
  -- devolve o registro existente em vez de duplicar.
  select * into v_row from public.viagens where client_uuid = p_client_uuid;
  if found then
    return v_row;
  end if;

  -- Garante que os cadastros referenciados ainda estão ATIVOS — sem isso,
  -- uma viagem que ficou esperando na fila offline do aparelho podia ser
  -- gravada contra um caminhão/destino/motorista desativado enquanto ela
  -- esperava conexão, corrompendo silenciosamente relatórios com um
  -- cadastro "fantasma". Os dois opcionais só são checados se informados.
  if not exists (select 1 from public.caminhoes where id = p_caminhao_id and ativo) then
    raise exception 'caminhao_inativo';
  end if;
  if not exists (select 1 from public.destinos where id = p_destino_id and ativo) then
    raise exception 'destino_inativo';
  end if;
  if not exists (select 1 from public.profiles where id = p_motorista_id and ativo) then
    raise exception 'motorista_inativo';
  end if;
  if p_escavadeira_id is not null and not exists (select 1 from public.escavadeiras where id = p_escavadeira_id and ativo) then
    raise exception 'escavadeira_inativa';
  end if;
  if p_local_carga_id is not null and not exists (select 1 from public.locais_carga where id = p_local_carga_id and ativo) then
    raise exception 'local_carga_inativo';
  end if;

  select coalesce(max(ordem), 0) + 1 into v_ordem
  from public.viagens
  where data = p_data;

  insert into public.viagens (
    client_uuid, data, ordem, caminhao_id, escavadeira_id, local_carga_id,
    destino_id, total_viagens, diesel_litros, motorista_id, registrado_em, criado_por
  ) values (
    p_client_uuid, p_data, v_ordem, p_caminhao_id, p_escavadeira_id, p_local_carga_id,
    p_destino_id, p_total_viagens, p_diesel_litros, p_motorista_id, p_registrado_em, p_criado_por
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Só service_role executa (RLS bloqueia leitura/escrita direta na tabela;
-- a função SECURITY DEFINER é o único caminho de escrita usado pelo backend).
revoke all on function public.criar_viagem from public;
grant execute on function public.criar_viagem to service_role;

-- ----------------------------------------------------------------------------
-- Alterar papel/status de um admin, com proteção atômica contra corrida
-- Mesmo motivo do lock em criar_viagem: sem isso, checar "ainda sobra outro
-- admin ativo?" e DEPOIS atualizar são duas chamadas separadas — com
-- exatamente 2 admins ativos, dois rebaixamentos/desativações quase
-- simultâneos (um mexendo no outro) podiam os dois passar pela checagem
-- antes de qualquer atualização terminar, deixando o sistema sem admin
-- nenhum. Aqui a checagem + a escrita rodam na mesma transação, travada.
-- ----------------------------------------------------------------------------
create or replace function public.usuarios_atualizar_com_protecao(
  p_id            uuid,
  p_id_quem_pediu uuid,
  p_nome          text default null,
  p_role          text default null,
  p_ativo         boolean default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atual                 public.profiles;
  v_role_final             text;
  v_ativo_final             boolean;
  v_outros_admins_ativos    integer;
  v_row                     public.profiles;
begin
  perform pg_advisory_xact_lock(hashtext('lrcv_admins'));

  select * into v_atual from public.profiles where id = p_id;
  -- Só mexe em admin/operador_avancado por aqui — mesma restrição que já
  -- existia no filtro .in('role', PAPEIS_VALIDOS) do endpoint (motorista se
  -- gerencia em /api/motoristas, não aqui).
  if not found or v_atual.role not in ('admin', 'operador_avancado') then
    raise exception 'usuario_nao_encontrado';
  end if;

  v_role_final := coalesce(p_role, v_atual.role);
  v_ativo_final := coalesce(p_ativo, v_atual.ativo);

  if v_atual.role = 'admin' and v_atual.ativo and (v_role_final <> 'admin' or v_ativo_final = false) then
    if p_id = p_id_quem_pediu then
      raise exception 'nao_pode_remover_proprio_admin';
    end if;

    select count(*) into v_outros_admins_ativos
    from public.profiles
    where role = 'admin' and ativo = true and id <> p_id;

    if v_outros_admins_ativos = 0 then
      raise exception 'ultimo_admin';
    end if;
  end if;

  update public.profiles
  set nome  = coalesce(p_nome, nome),
      role  = v_role_final,
      ativo = v_ativo_final
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.usuarios_atualizar_com_protecao from public;
grant execute on function public.usuarios_atualizar_com_protecao to service_role;

-- ----------------------------------------------------------------------------
-- Seed inicial opcional — descomente e ajuste para popular os cadastros que
-- já aparecem na planilha de papel. O admin também pode cadastrar tudo isso
-- pela tela de Cadastros do sistema.
-- ----------------------------------------------------------------------------
-- insert into public.caminhoes (codigo) values ('CB 236'), ('CB 260'), ('CB 577'), ('CB 162'), ('CB 564'), ('CB 572');
-- insert into public.escavadeiras (codigo) values ('EH 349');
-- insert into public.destinos (codigo, descricao) values ('AT.O', 'Aterro - Obra'), ('BF.O', 'Bota-fora - Obra'), ('AT.L', 'Aterro - Local');
