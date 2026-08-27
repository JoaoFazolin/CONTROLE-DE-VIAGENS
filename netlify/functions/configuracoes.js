const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized, forbidden } = require('./lib/authGuard');

// Chaves conhecidas de configuração (documentação, não uma trava técnica):
//   obra_padrao_id -> id da obra usada automaticamente no lançamento do
//                     Operador, que não escolhe mais a obra na tela dele.

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();

  const headers = { 'Content-Type': 'application/json' };
  const supabase = getSupabase();

  try {
    if (event.httpMethod === 'GET') {
      // qualquer usuário autenticado pode ler (o app usa isso, por
      // exemplo, para saber se já existe uma obra padrão configurada).
      const { data, error } = await supabase.from('configuracoes').select('chave, valor');
      if (error) throw error;
      const mapa = {};
      (data || []).forEach((c) => { mapa[c.chave] = c.valor; });
      return { statusCode: 200, headers, body: JSON.stringify(mapa) };
    }

    // alterar configurações: exclusivo do Administrador.
    if (event.httpMethod === 'PUT') {
      if (auth.profile.role !== 'admin') return forbidden('Apenas o administrador pode alterar as configurações.');
      const body = JSON.parse(event.body || '{}');
      const chave = (body.chave || '').trim();
      if (!chave) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Chave é obrigatória.' }) };
      const valor = body.valor === undefined || body.valor === null ? null : String(body.valor);

      const { data, error } = await supabase
        .from('configuracoes')
        .upsert({ chave, valor, atualizado_por: auth.profile.id, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
