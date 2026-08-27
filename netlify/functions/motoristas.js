const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized, forbidden, podeGerenciar } = require('./lib/authGuard');

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();

  const headers = { 'Content-Type': 'application/json' };
  const supabase = getSupabase();

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase.from('motoristas').select('*').order('nome', { ascending: true });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (!podeGerenciar(auth.profile)) return forbidden('Apenas administradores e operadores avançados podem gerenciar motoristas.');

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const nome = (body.nome || '').trim();
      if (!nome) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome do motorista é obrigatório.' }) };
      const { data, error } = await supabase.from('motoristas').insert({ nome }).select().single();
      if (error) throw error;
      return { statusCode: 201, headers, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      const { error } = await supabase.from('motoristas').delete().eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
