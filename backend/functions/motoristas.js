const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight, safeJsonParse } = require('../lib/http');

// /api/motoristas
// GET: qualquer usuário autenticado (precisa da lista pra montar o formulário
//      de viagem, e admin lançando "por" um motorista específico).
// POST: admin cria um motorista novo — cria o login no Supabase Auth E o
//       perfil (profiles) na mesma chamada.
// PUT: admin edita nome/papel/ativo (não mexe em senha aqui).
// DELETE: admin desativa (não apaga — histórico de viagens referencia o id).
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  const supabase = getSupabaseAdmin();

  if (event.httpMethod === 'GET') {
    const auth = await requireAuth(event);
    if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

    const somenteAtivos = event.queryStringParameters?.todos !== '1';
    let query = supabase
      .from('profiles')
      .select('id, nome, role, ativo, criado_em')
      .order('nome', { ascending: true });
    if (somenteAtivos) query = query.eq('ativo', true);

    const { data, error } = await query;
    if (error) return json(500, { erro: 'Erro ao buscar motoristas.', detalhe: error.message });
    return json(200, { itens: data });
  }

  const auth = await requireAuth(event, { adminOnly: true });
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

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
    const papel = role === 'admin' ? 'admin' : 'motorista';

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
    if (!id) return json(400, { erro: 'Informe o id do motorista.' });

    const payload = {};
    if (body.nome !== undefined) payload.nome = String(body.nome).trim();
    if (body.role !== undefined) payload.role = body.role === 'admin' ? 'admin' : 'motorista';
    if (body.ativo !== undefined) payload.ativo = !!body.ativo;

    const { data, error } = await supabase.from('profiles').update(payload).eq('id', id).select().single();
    if (error) return json(500, { erro: 'Erro ao atualizar.', detalhe: error.message });
    return json(200, { item: data });
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { erro: 'Informe o id do motorista.' });

    const { error } = await supabase.from('profiles').update({ ativo: false }).eq('id', id);
    if (error) return json(500, { erro: 'Erro ao desativar.', detalhe: error.message });
    return json(200, { ok: true });
  }

  return json(405, { erro: 'Método não permitido.' });
};
