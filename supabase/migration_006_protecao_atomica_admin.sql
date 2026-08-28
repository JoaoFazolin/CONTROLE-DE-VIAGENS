-- ============================================================================
-- Migração 006 — LR Controle de Viagens
-- Rode no SQL Editor do Supabase DEPOIS das migrações anteriores.
-- Não apaga nem altera nenhum dado existente.
--
-- O que muda:
-- A migração 005 corrigiu bugs de duplicidade/race condition; nessa mesma
-- rodada de revisão, sobrou uma corrida bem mais rara em /api/usuarios: a
-- checagem "ainda sobra outro admin ativo" e a atualização em si (rebaixar
-- ou desativar) eram duas chamadas SEPARADAS ao banco. Com EXATAMENTE 2
-- admins ativos, se os dois forem rebaixados/desativados ao mesmo tempo
-- (dois cliques quase simultâneos, um por cada admin, cada um mexendo no
-- outro), as duas checagens podem rodar antes de qualquer atualização
-- terminar — cada uma vendo "o outro ainda está ativo" — e o sistema fica
-- sem NENHUM admin ativo, sem ninguém conseguindo entrar nas telas
-- administrativas pra desfazer.
--
-- A correção: a checagem + a atualização passam a rodar dentro da MESMA
-- função no banco, travada com pg_advisory_xact_lock (igual já é feito em
-- criar_viagem() pra evitar corrida na numeração das viagens do dia) — só
-- uma chamada de cada vez consegue mexer no papel/status de um admin.
-- ============================================================================

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
  v_atual                    public.profiles;
  v_role_final                text;
  v_ativo_final                boolean;
  v_outros_admins_ativos       integer;
  v_row                        public.profiles;
begin
  -- Trava só entra em jogo quando pode afetar quem é admin — serializa
  -- qualquer alteração concorrente de papel/status pra ninguém conseguir
  -- "passar" pela checagem ao mesmo tempo que outra chamada.
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
