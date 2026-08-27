const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized, forbidden } = require('./lib/authGuard');

// Busca a "obra padrão" configurada pelo Administrador — usada
// automaticamente quando o lançamento não vem com obra_id (é o caso do
// Operador, que não escolhe mais a obra na tela dele).
async function obraPadraoId(supabase) {
  const { data } = await supabase.from('configuracoes').select('valor').eq('chave', 'obra_padrao_id').maybeSingle();
  return data && data.valor ? data.valor : null;
}

function sanitize(body) {
  return {
    data: body.data,
    hora: (body.hora || '').trim() || null,
    operador: (body.operador || '').trim(),
    obra_id: body.obra_id || null,
    equipamento_id: body.equipamento_id || null,
    tipo_oleo_id: body.tipo_oleo_id || null,
    litros: Number(body.litros)
  };
}

function validate(p) {
  if (!p.data) return 'Data é obrigatória.';
  if (!p.obra_id) return 'Obra é obrigatória.';
  if (!p.equipamento_id) return 'Equipamento é obrigatório.';
  if (!p.tipo_oleo_id) return 'Tipo de lubrificante é obrigatório.';
  if (!p.operador) return 'Operador/motorista é obrigatório.';
  if (p.litros === undefined || p.litros === null || isNaN(p.litros) || p.litros <= 0) return 'Quantidade de lubrificante é obrigatória.';
  return null;
}

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();

  const headers = { 'Content-Type': 'application/json' };
  const supabase = getSupabase();

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      let query = supabase
        .from('lancamentos_oleo')
        .select('id, data, hora, operador, litros, created_at, obra_id, equipamento_id, tipo_oleo_id, criado_por, equipamentos ( id, nome ), obras ( id, nome ), tipos_oleo ( id, nome )');

      if (q.de) query = query.gte('data', q.de);
      if (q.ate) query = query.lte('data', q.ate);
      if (q.equipamento_id) query = query.eq('equipamento_id', q.equipamento_id);
      if (q.obra_id) query = query.eq('obra_id', q.obra_id);
      if (q.tipo_oleo_id) query = query.eq('tipo_oleo_id', q.tipo_oleo_id);
      if (q.operador) query = query.ilike('operador', `%${q.operador}%`);

      query = query.order('data', { ascending: true }).order('created_at', { ascending: true });

      const { data, error } = await query;
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // qualquer usuario logado (admin, operador avançado ou operador) pode lançar lubrificante
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const payload = sanitize(body);
      if (!payload.obra_id) payload.obra_id = await obraPadraoId(supabase);
      const errMsg = validate(payload);
      if (errMsg) return { statusCode: 400, headers, body: JSON.stringify({ error: errMsg }) };
      payload.criado_por = auth.profile.id;
      const clientRef = body.client_ref || null;
      payload.client_ref = clientRef;

      if (clientRef) {
        const { data: existente } = await supabase.from('lancamentos_oleo').select('id, data, hora, operador, litros, created_at, obra_id, equipamento_id, tipo_oleo_id, criado_por, equipamentos ( id, nome ), obras ( id, nome ), tipos_oleo ( id, nome )').eq('client_ref', clientRef).maybeSingle();
        if (existente) return { statusCode: 200, headers, body: JSON.stringify(existente) };
      }

      const { data, error } = await supabase.from('lancamentos_oleo').insert(payload).select().single();
      if (error) {
        if (error.code === '23505' && clientRef) {
          const { data: existente2 } = await supabase.from('lancamentos_oleo').select().eq('client_ref', clientRef).single();
          if (existente2) return { statusCode: 200, headers, body: JSON.stringify(existente2) };
        }
        throw error;
      }
      return { statusCode: 201, headers, body: JSON.stringify(data) };
    }

    // editar: agora exclusivo do Administrador.
    if (event.httpMethod === 'PUT') {
      if (auth.profile.role !== 'admin') return forbidden('Apenas o administrador pode editar lançamentos de lubrificante.');
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      const body = JSON.parse(event.body || '{}');
      const payload = sanitize(body);
      const errMsg = validate(payload);
      if (errMsg) return { statusCode: 400, headers, body: JSON.stringify({ error: errMsg }) };
      payload.atualizado_por = auth.profile.id;

      const { data, error } = await supabase.from('lancamentos_oleo').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // excluir: agora exclusivo do Administrador.
    if (event.httpMethod === 'DELETE') {
      if (auth.profile.role !== 'admin') return forbidden('Apenas o administrador pode excluir lançamentos de lubrificante.');
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      const { error } = await supabase.from('lancamentos_oleo').delete().eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
