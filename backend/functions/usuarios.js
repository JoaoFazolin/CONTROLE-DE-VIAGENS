const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight, safeJsonParse, comTratamentoDeErro } = require('../lib/http');

// /api/usuarios — só admin. Gerencia quem realmente LOGA no sistema
// (Operador Avançado e Administrador — motorista não loga, isso é
// cadastrado em /api/motoristas, sem e-mail/senha). Cria o login no
// Supabase Auth E o perfil (profiles) na mesma chamada, igual o antigo
// /api/motoristas fazia antes da migration_004 separar os dois.
const PAPEIS_VALIDOS = ['admin', 'operador_avancado'];
function normalizarPapel(role) {
  return PAPEIS_VALIDOS.includes(role) ? role : 'operador_avancado';
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

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: senha,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      return json(400, { erro: createError?.message || 'Não foi possível criar o login.' });
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

    const payload = {};
    if (body.nome !== undefined) payload.nome = String(body.nome).trim();
    if (body.role !== undefined) payload.role = normalizarPapel(body.role);
    if (body.ativo !== undefined) payload.ativo = !!body.ativo;

    const { data, error } = await supabase.from('profiles').update(payload).eq('id', id).in('role', PAPEIS_VALIDOS).select().single();
    if (error) return json(500, { erro: 'Erro ao atualizar.', detalhe: error.message });
    if (!data) return json(404, { erro: 'Usuário não encontrado (ou é um motorista — edite em Motoristas).' });
    return json(200, { item: data });
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { erro: 'Informe o id do usuário.' });

    const { error } = await supabase.from('profiles').update({ ativo: false }).eq('id', id).in('role', PAPEIS_VALIDOS);
    if (error) return json(500, { erro: 'Erro ao desativar.', detalhe: error.message });
    return json(200, { ok: true });
  }

  return json(405, { erro: 'Método não permitido.' });
});
