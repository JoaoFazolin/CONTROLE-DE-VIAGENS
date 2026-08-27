const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized, forbidden } = require('./lib/authGuard');

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();

  const headers = { 'Content-Type': 'application/json' };
  const supabase = getSupabase();

  try {
    if (event.httpMethod === 'GET') {
      // qualquer usuario logado pode ver a lista (so nomes e papeis, sem dado sensivel)
      const { data, error } = await supabase.from('profiles').select('id, nome, role, created_at').order('nome');
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // criar e remover usuario: apenas admin
    if (auth.profile.role !== 'admin') return forbidden('Apenas administradores podem gerenciar usuários.');

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const email = (body.email || '').trim();
      const password = body.password || '';
      const nome = (body.nome || '').trim();
      const role = ['admin', 'operador_avancado'].includes(body.role) ? body.role : 'operador';

      if (!email || !password || !nome) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome, e-mail e senha são obrigatórios.' }) };
      }
      if (password.length < 6) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'A senha precisa ter ao menos 6 caracteres.' }) };
      }

      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true
      });
      if (createError) throw createError;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .insert({ id: created.user.id, nome, role })
        .select()
        .single();
      if (profileError) {
        // o usuário de autenticação já foi criado, mas o perfil falhou —
        // desfaz a criação para não deixar uma conta "fantasma" (que
        // consegue logar mas não tem papel nenhum) e para permitir tentar
        // de novo com o mesmo e-mail em seguida.
        await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
        throw profileError;
      }

      return { statusCode: 201, headers, body: JSON.stringify(profile) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      if (id === auth.user.id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Você não pode remover seu próprio usuário.' }) };
      }
      const { error } = await supabase.auth.admin.deleteUser(id);
      if (error) throw error;
      // profiles é removido automaticamente (on delete cascade)
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
