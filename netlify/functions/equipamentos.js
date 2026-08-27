const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized, forbidden, podeGerenciar } = require('./lib/authGuard');

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();

  const headers = { 'Content-Type': 'application/json' };
  const supabase = getSupabase();

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('equipamentos')
        .select('id, nome, tipo_combustivel_id, created_at')
        .order('nome', { ascending: true });
      if (error) throw error;
      
      // Se precisar do nome do combustível, faz um segundo fetch
      const tiposMap = {};
      if (data.length > 0) {
        const tipoIds = [...new Set(data.map(e => e.tipo_combustivel_id).filter(Boolean))];
        if (tipoIds.length > 0) {
          const { data: tipos } = await supabase.from('tipos_combustivel').select('id, nome').in('id', tipoIds);
          tipos.forEach(t => tiposMap[t.id] = t);
          data.forEach(e => {
            if (e.tipo_combustivel_id) e.tipos_combustivel = tiposMap[e.tipo_combustivel_id];
          });
        }
      }
      
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (!podeGerenciar(auth.profile)) return forbidden('Apenas administradores e operadores avançados podem gerenciar equipamentos.');

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const nome = (body.nome || '').trim();
      if (!nome) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome do equipamento é obrigatório.' }) };
      const payload = { nome, tipo_combustivel_id: body.tipo_combustivel_id || null };
      const { data, error } = await supabase.from('equipamentos').insert(payload).select().single();
      if (error) throw error;
      return { statusCode: 201, headers, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      const { error } = await supabase.from('equipamentos').delete().eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
