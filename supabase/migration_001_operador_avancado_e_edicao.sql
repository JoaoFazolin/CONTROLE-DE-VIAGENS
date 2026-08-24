-- ============================================================================
-- Migração 001 — LR Controle de Viagens
-- Rode no SQL Editor do Supabase DEPOIS do schema.sql já ter rodado.
-- Não apaga nem altera nenhum dado existente.
--
-- O que muda:
-- 1. Novo papel "operador_avancado": acesso quase igual ao admin (gerencia
--    cadastros de caminhão/escavadeira/local/destino, lança viagem por
--    qualquer motorista, vê Relatórios e Dashboard) — EXCETO: não gerencia
--    Motoristas (usuários) e não edita/exclui viagens já lançadas. Isso
--    espelha o "Operador Avançado" do sistema de combustível.
-- 2. Permite ao admin corrigir manualmente o número da "Ordem" de uma
--    viagem (ex: se a sequência do dia ficar errada por algum motivo) —
--    isso já era possível via UPDATE direto, essa migração só documenta a
--    trava de unicidade que impede duas viagens com a mesma Ordem no
--    mesmo dia ao corrigir.
-- ============================================================================

-- 1. Amplia o papel aceito em profiles.role
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'operador_avancado', 'motorista'));

-- 2. Nada a mudar na tabela viagens — a constraint unique(data, ordem) já
--    existente no schema.sql é o que impede uma correção manual de Ordem
--    criar um número duplicado no mesmo dia (o UPDATE simplesmente falha
--    com erro de unicidade, e o backend devolve 409 pro admin tentar outro
--    número).

-- Para promover alguém a Operador Avançado depois de já cadastrado como
-- motorista comum, rode (trocando o e-mail):
--
--   update public.profiles set role = 'operador_avancado'
--   where id = (select id from auth.users where email = 'email@exemplo.com');
