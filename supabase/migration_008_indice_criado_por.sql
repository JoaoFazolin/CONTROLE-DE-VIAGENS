-- ============================================================================
-- Migração 008 — LR Controle de Viagens
-- Rode no SQL Editor do Supabase DEPOIS das migrações anteriores.
-- Não apaga nem altera nenhum dado existente — só cria um índice.
--
-- O que muda:
-- Faltava um índice em viagens.criado_por, embora essa coluna seja o filtro
-- mais usado no dia a dia: todo GET de /api/viagens e /api/resumo-dia feito
-- por um Operador Avançado (quem realmente loga e lança, na prática) filtra
-- por "o que EU mesmo lancei" (criado_por), não por motorista. Sem o
-- índice, essas consultas fazem sequential scan na tabela toda, o que fica
-- cada vez mais lento conforme o histórico de viagens cresce.
-- ============================================================================

create index if not exists idx_viagens_criado_por on public.viagens (criado_por);
