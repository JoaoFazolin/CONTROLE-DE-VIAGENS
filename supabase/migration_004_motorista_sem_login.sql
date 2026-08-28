-- ============================================================================
-- Migração 004 — LR Controle de Viagens
-- Rode no SQL Editor do Supabase DEPOIS das migrações anteriores.
-- Não apaga nem altera nenhum dado existente.
--
-- O que muda:
-- Até aqui, TODO registro em "profiles" (a tabela que guarda motoristas,
-- operadores e admins) precisava ter um login de verdade no Supabase Auth,
-- porque profiles.id era uma foreign key pra auth.users(id). Isso obrigava
-- a cadastrar e-mail/senha até pra um motorista que nunca vai abrir o app
-- (só serve pra aparecer na lista e ser vinculado a um caminhão).
--
-- Agora profiles.id vira um uuid gerado automaticamente (sem depender de
-- auth.users existir) — motoristas passam a ser só um registro de nome,
-- sem login. Quem realmente precisa logar (Operador Avançado e Admin)
-- continua sendo criado com login de verdade, só que por uma tela/endpoint
-- separado (/api/usuarios) que ainda cria o par auth.users + profiles.
-- ============================================================================

-- 1. Remove o vínculo obrigatório com auth.users — sem isso, não dava pra
--    criar um profile "motorista" sem antes criar um login pra ele.
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- 2. Deixa o banco gerar o id sozinho quando quem insere não manda um
--    (é o caso do motorista sem login; quem tem login continua mandando o
--    id do auth.users criado, igual antes).
alter table public.profiles alter column id set default gen_random_uuid();

-- Nenhum dado existente muda: motoristas/operadores/admins já cadastrados
-- continuam com o mesmo id (que já é o id do login deles no Supabase Auth).
