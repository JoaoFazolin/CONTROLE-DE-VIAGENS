-- ============================================================
-- MIGRACAO 010 — Marcador à prova de falha (nunca mais quebra)
-- Rode este script no SQL Editor do Supabase.
--
-- Por que isso é necessário: mesmo com a correção anterior (buscar o
-- marcador no servidor, não no celular), ainda existia uma janela muito
-- pequena de risco — se DUAS pessoas salvassem um lançamento quase ao
-- mesmo tempo, as duas poderiam "ler" o mesmo marcador anterior antes de
-- qualquer uma das duas salvar, criando uma pequena inconsistência.
--
-- Esta migração cria uma função no próprio banco de dados que faz tudo
-- de uma vez só, de forma travada: busca o último marcador, calcula o
-- novo e salva o lançamento — sem deixar nenhuma outra tentativa
-- "furar a fila" no meio do caminho. O Postgres garante isso sozinho.
-- ============================================================

create or replace function inserir_lancamento_combustivel(
  p_data date,
  p_hora text,
  p_operador text,
  p_obra_id uuid,
  p_equipamento_id uuid,
  p_tipo_combustivel_id uuid,
  p_marcador_inicial numeric,
  p_litros numeric,
  p_km_hora numeric,
  p_criado_por uuid,
  p_client_ref text
) returns lancamentos
language plpgsql
as $$
declare
  v_existente lancamentos;
  v_marcador_inicial numeric;
  v_marcador_final numeric;
  v_novo lancamentos;
begin
  -- protecao contra duplicado: se esse lançamento (mesma "impressão
  -- digital" do celular) já foi salvo antes, devolve o que já existe.
  if p_client_ref is not null then
    select * into v_existente from lancamentos where client_ref = p_client_ref;
    if found then
      return v_existente;
    end if;
  end if;

  -- trava: enquanto este lançamento está sendo calculado, qualquer outro
  -- lançamento de combustível que tentar entrar ao mesmo tempo espera na
  -- fila, em vez de ler o marcador desatualizado. Libera sozinha quando
  -- esta função termina.
  perform pg_advisory_xact_lock(hashtext('marcador_combustivel'));

  if p_marcador_inicial is not null then
    v_marcador_inicial := p_marcador_inicial;
  else
    select marcador_final into v_marcador_inicial
    from lancamentos
    where marcador_final is not null
    order by data desc, created_at desc
    limit 1;
  end if;

  if v_marcador_inicial is not null then
    v_marcador_final := round((v_marcador_inicial + p_litros)::numeric, 2);
  else
    v_marcador_final := null;
  end if;

  insert into lancamentos (
    data, hora, operador, obra_id, equipamento_id, tipo_combustivel_id,
    marcador_inicial, marcador_final, litros, km_hora, criado_por, client_ref
  ) values (
    p_data, p_hora, p_operador, p_obra_id, p_equipamento_id, p_tipo_combustivel_id,
    v_marcador_inicial, v_marcador_final, p_litros, p_km_hora, p_criado_por, p_client_ref
  ) returning * into v_novo;

  return v_novo;
exception
  when unique_violation then
    -- corrida raríssima: outra tentativa com o mesmo client_ref inseriu
    -- entre a checagem lá em cima e o insert aqui — devolve o que já existe.
    select * into v_existente from lancamentos where client_ref = p_client_ref;
    return v_existente;
end;
$$;
