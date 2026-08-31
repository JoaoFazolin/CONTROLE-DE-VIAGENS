const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight, safeJsonParse, comTratamentoDeErro } = require('../lib/http');

// /api/usuarios — só admin. Gerencia quem realmente LOGA no sistema
// (Operador Avançado e Administrador — motorista não loga, isso é
// cadastrado em /api/motoristas, sem e-mail/senha). Cria o login no
// Supabase Auth E o perfil (profiles) na mesma chamada, igual o antigo
// /api/motoristas fazia antes da migration_004 separar os dois.
const PAPEIS_VALIDOS = ['admin', 'operador_avancado'];
// Antes, um `role` inválido/com erro de digitação (ex: "Admin" com
// maiúscula) era silenciosamente trocado por 'operador_avancado' — a
// chamada voltava 200/201 como se tivesse dado certo, e o admin só
// descobria depois (ou nunca) que a promoção não tinha funcionado. Agora
// devolve null pra quem chamou rejeitar com um erro claro.
function normalizarPapel(role) {
  return PAPEIS_VALIDOS.includes(role) ? role : null;
}

// Rebaixar (tirar do papel admin) ou desativar alguém passa pela function
// usuarios_atualizar_com_protecao (migration_006) em vez de um update direto
// na tabela: ela roda a checagem de "sobra outro admin?" e a escrita dentro
// da MESMA transação, travada com pg_advisory_xact_lock — sem isso, checar
// e escrever em duas chamadas separadas deixava uma corrida rara possível
// (dois admins sendo rebaixados/desativados ao mesmo tempo, um pelo outro,
// cada checagem vendo "o outro ainda tá ativo" antes de qualquer escrita
// terminar — o sistema ficava sem NENHUM admin ativo). A function também
// bloqueia sozinha a autoexclusão (idAlvo === idQuemPediu).
const MENSAGENS_ERRO_RPC_USUARIO = {
  usuario_nao_encontrado: { statusCode: 404, mensagem: 'Usuário não encontrado (ou é um motorista — edite em Motoristas).' },
  nao_pode_remover_proprio_admin: {
    statusCode: 400,
    mensagem: 'Você não pode remover seu próprio acesso de administrador nem desativar sua própria conta por aqui — peça para outro administrador fazer essa alteração.',
  },
  ultimo_admin: { statusCode: 400, mensagem: 'Não é possível remover o último administrador ativo do sistema.' },
};
function respostaErroRpcUsuario(error) {
  const chave = Object.keys(MENSAGENS_ERRO_RPC_USUARIO).find((k) => error?.message?.includes(k));
  if (chave) return json(MENSAGENS_ERRO_RPC_USUARIO[chave].statusCode, { erro: MENSAGENS_ERRO_RPC_USUARIO[chave].mensagem });
  return json(500, { erro: 'Erro ao atualizar usuário.', detalhe: error?.message });
}

exports.handler = comTratamentoDeErro(async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  const supabase = getSupabaseAdmin();

  const auth = await requireAuth(event, { adminOnly: true });
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  if (event.httpMethod === 'GET') {
    const somenteAtivos = event.queryStringParameters?.todos !== '1';
    let query = supabase
      .from('profiles')
      .select('id, nome, role, ativo, criado_em')
      .in('role', PAPEIS_VALIDOS)
      .order('nome', { ascending: true });
    if (somenteAtivos) query = query.eq('ativo', true);

    const { data, error } = await query;
    if (error) return json(500, { erro: 'Erro ao buscar usuários.', detalhe: error.message });
    return json(200, { itens: data });
  }

  if (event.httpMethod === 'POST') {
    const body = safeJsonParse(event.body);
    if (!body) return json(400, { erro: 'JSON inválido.' });
    const { email, senha, nome, role } = body;
    if (!email || !senha || !nome) {
      return json(400, { erro: 'Informe e-mail, senha e nome.' });
    }
    if (senha.length < 6) {
      return json(400, { erro: 'A senha precisa ter pelo menos 6 caracteres.' });
    }
    const papel = normalizarPapel(role);
    if (!papel) return json(400, { erro: `Papel inválido. Use: ${PAPEIS_VALIDOS.join(' ou ')}.` });
    const emailNormalizado = String(email).trim().toLowerCase();

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: emailNormalizado,
      password: senha,
      email_confirm: true,
    });

    if (createError || !created?.user) {
      // "Excluir" um usuário só desativa o perfil (nunca apaga o login do
      // Supabase Auth — senão perderia o vínculo com viagens que ele já
      // lançou). Isso significa que recriar com o MESMO e-mail esbarra num
      // login que já existe (createUser recusa e-mail duplicado). Em vez de
      // travar, procura esse login existente e reativa (ou recupera) o
      // perfil dele, com o nome/papel/senha novos.
      const { data: listagem, error: erroListagem } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const usuarioExistente = erroListagem ? null : listagem?.users?.find((u) => u.email?.toLowerCase() === emailNormalizado);

      if (!usuarioExistente) {
        return json(400, { erro: createError?.message || 'Não foi possível criar o login.' });
      }

      const { data: perfilExistente } = await supabase
        .from('profiles')
        .select('id, ativo')
        .eq('id', usuarioExistente.id)
        .maybeSingle();

      if (perfilExistente?.ativo) {
        return json(409, { erro: 'Já existe um usuário ativo com esse e-mail.' });
      }

      // Atualiza a senha também — o e-mail pode estar sendo reaproveitado
      // por outra pessoa, não faz sentido a senha antiga continuar valendo.
      await supabase.auth.admin.updateUserById(usuarioExistente.id, { password: senha });

      const dadosPerfil = { nome: nome.trim(), role: papel, ativo: true };
      const { data: perfilSalvo, error: erroSalvar } = perfilExistente
        ? await supabase.from('profiles').update(dadosPerfil).eq('id', usuarioExistente.id).select().single()
        : await supabase.from('profiles').insert({ id: usuarioExistente.id, ...dadosPerfil }).select().single();

      if (erroSalvar) return json(500, { erro: 'Erro ao reativar usuário.', detalhe: erroSalvar.message });
      return json(201, { item: perfilSalvo });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({ id: created.user.id, nome: nome.trim(), role: papel, ativo: true })
      .select()
      .single();

    if (profileError) {
      // limpa o usuário de auth órfão se o profile falhar, pra não deixar lixo
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
      return json(500, { erro: 'Erro ao criar perfil.', detalhe: profileError.message });
    }

    return json(201, { item: profile });
  }

  if (event.httpMethod === 'PUT') {
    const body = safeJsonParse(event.body);
    const id = body?.id;
    if (!id) return json(400, { erro: 'Informe o id do usuário.' });

    const rpcArgs = { p_id: id, p_id_quem_pediu: auth.user.id };
    if (body.nome !== undefined) {
      // Sem essa checagem, um PUT com nome em branco (ou só espaços)
      // gravava string vazia sem erro: a RPC faz `coalesce(p_nome, nome)`,
      // e uma string vazia não é NULL — o coalesce não protege contra isso.
      const nome = String(body.nome).trim();
      if (!nome) return json(400, { erro: 'Informe o nome do usuário.' });
      rpcArgs.p_nome = nome;
    }
    if (body.role !== undefined) {
      const papel = normalizarPapel(body.role);
      if (!papel) return json(400, { erro: `Papel inválido. Use: ${PAPEIS_VALIDOS.join(' ou ')}.` });
      rpcArgs.p_role = papel;
    }
    if (body.ativo !== undefined) rpcArgs.p_ativo = !!body.ativo;

    const { data, error } = await supabase.rpc('usuarios_atualizar_com_protecao', rpcArgs).single();
    if (error) return respostaErroRpcUsuario(error);
    return json(200, { item: data });
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { erro: 'Informe o id do usuário.' });

    const { error } = await supabase
      .rpc('usuarios_atualizar_com_protecao', { p_id: id, p_id_quem_pediu: auth.user.id, p_ativo: false })
      .single();
    if (error) return respostaErroRpcUsuario(error);
    return json(200, { ok: true });
  }

  return json(405, { erro: 'Método não permitido.' });
});
