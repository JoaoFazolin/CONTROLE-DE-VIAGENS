const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized, forbidden } = require('./lib/authGuard');

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();

  const headers = { 'Content-Type': 'application/json' };
  const supabase = getSupabase();

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase.from('tipos_combustivel').select('*').order('nome');
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (auth.profile.role !== 'admin') return forbidden('Apenas administradores podem gerenciar tipos de combustível.');

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const nome = (body.nome || '').trim();
      if (!nome) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome do combustível é obrigatório.' }) };
      const estoque_minimo = body.estoque_minimo === '' || body.estoque_minimo === undefined ? 0 : Number(body.estoque_minimo);
      const { data, error } = await supabase.from('tipos_combustivel').insert({ nome, estoque_minimo }).select().single();
      if (error) throw error;
      return { statusCode: 201, headers, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'PUT') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      const body = JSON.parse(event.body || '{}');
      const payload = {};
      if (body.nome !== undefined) payload.nome = body.nome.trim();
      if (body.estoque_minimo !== undefined) payload.estoque_minimo = Number(body.estoque_minimo);
      const { data, error } = await supabase.from('tipos_combustivel').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      const { error } = await supabase.from('tipos_combustivel').delete().eq('id', id);
      if (error) {
        // 23503 = chave estrangeira: esse combustível já foi usado em
        // lançamentos, entradas ou está vinculado a algum equipamento —
        // não pode ser apagado, para preservar o histórico.
        if (error.code === '23503') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Este combustível já está em uso (em lançamentos, entradas ou equipamentos) e não pode ser excluído, para preservar o histórico.' }) };
        }
        throw error;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
