const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized, forbidden } = require('./lib/authGuard');

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();

  const headers = { 'Content-Type': 'application/json' };
  const supabase = getSupabase();

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      let query = supabase
        .from('entradas_oleo')
        .select('id, data, litros, fornecedor, nota_fiscal, observacao, created_at, tipo_oleo_id, criado_por, tipos_oleo ( id, nome )')
        .order('data', { ascending: false })
        .order('created_at', { ascending: false });
      if (q.de) query = query.gte('data', q.de);
      if (q.ate) query = query.lte('data', q.ate);
      if (q.tipo_oleo_id) query = query.eq('tipo_oleo_id', q.tipo_oleo_id);
      const { data, error } = await query;
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // registrar entrada de lubrificante: agora exclusivo do Administrador — antes
    // era aberto pra qualquer papel, mas isso mudou junto com a entrada de
    // combustível, pra manter as duas com a mesma regra.
    if (event.httpMethod === 'POST') {
      if (auth.profile.role !== 'admin') return forbidden('Apenas o administrador pode registrar entrada de lubrificante.');
      const body = JSON.parse(event.body || '{}');
      const clientRef = body.client_ref || null;
      const payload = {
        data: body.data,
        tipo_oleo_id: body.tipo_oleo_id || null,
        litros: Number(body.litros),
        fornecedor: (body.fornecedor || '').trim() || null,
        nota_fiscal: (body.nota_fiscal || '').trim() || null,
        observacao: (body.observacao || '').trim() || null,
        criado_por: auth.profile.id,
        client_ref: clientRef
      };
      if (!payload.data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Data é obrigatória.' }) };
      if (!payload.tipo_oleo_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Tipo de lubrificante é obrigatório.' }) };
      if (!payload.litros || payload.litros <= 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Informe a quantidade recebida.' }) };

      if (clientRef) {
        const { data: existente } = await supabase.from('entradas_oleo').select().eq('client_ref', clientRef).maybeSingle();
        if (existente) return { statusCode: 200, headers, body: JSON.stringify(existente) };
      }

      const { data, error } = await supabase.from('entradas_oleo').insert(payload).select().single();
      if (error) {
        if (error.code === '23505' && clientRef) {
          const { data: existente2 } = await supabase.from('entradas_oleo').select().eq('client_ref', clientRef).single();
          if (existente2) return { statusCode: 200, headers, body: JSON.stringify(existente2) };
        }
        throw error;
      }
      return { statusCode: 201, headers, body: JSON.stringify(data) };
    }

    // excluir uma entrada já registrada: agora exclusivo do Administrador.
    if (event.httpMethod === 'DELETE') {
      if (auth.profile.role !== 'admin') return forbidden('Apenas o administrador pode excluir entradas de lubrificante.');
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      const { error } = await supabase.from('entradas_oleo').delete().eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
