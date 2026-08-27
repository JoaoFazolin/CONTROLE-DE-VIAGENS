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
  const p = {
    data: body.data,
    hora: (body.hora || '').trim() || null,
    operador: (body.operador || '').trim(),
    obra_id: body.obra_id || null,
    equipamento_id: body.equipamento_id || null,
    tipo_combustivel_id: body.tipo_combustivel_id || null,
    marcador_inicial: body.marcador_inicial === '' || body.marcador_inicial === undefined || body.marcador_inicial === null
      ? null : Number(body.marcador_inicial),
    marcador_final: body.marcador_final === '' || body.marcador_final === undefined || body.marcador_final === null
      ? null : Number(body.marcador_final),
    litros: Number(body.litros),
    km_hora: body.km_hora === '' || body.km_hora === undefined || body.km_hora === null
      ? null : Number(body.km_hora)
  };
  // Esse cálculo simples aqui só é usado para EDITAR um lançamento já
  // existente. Para lançamentos NOVOS (criados via POST), a busca do
  // marcador anterior e o cálculo do novo acontecem travados dentro do
  // banco de dados (função inserir_lancamento_combustivel), garantindo
  // que nunca quebrem, mesmo com dois lançamentos chegando ao mesmo tempo.
  if (p.marcador_inicial !== null && !isNaN(p.litros)) {
    p.marcador_final = Math.round((p.marcador_inicial + p.litros) * 100) / 100;
  }
  return p;
}

function validate(p) {
  if (!p.data) return 'Data é obrigatória.';
  if (!p.obra_id) return 'Obra é obrigatória.';
  if (!p.equipamento_id) return 'Equipamento é obrigatório.';
  if (!p.tipo_combustivel_id) return 'Tipo de combustível é obrigatório.';
  if (!p.operador) return 'Operador/motorista é obrigatório.';
  if (p.litros === undefined || p.litros === null || isNaN(p.litros) || p.litros <= 0) return 'Litros de saída deve ser maior que zero.';
  if (p.marcador_inicial !== null && p.marcador_final !== null && p.marcador_final < p.marcador_inicial) {
    return 'O marcador final não pode ser menor que o marcador inicial.';
  }
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
        .from('lancamentos')
        .select('id, data, hora, operador, marcador_inicial, marcador_final, litros, km_hora, created_at, obra_id, equipamento_id, tipo_combustivel_id, criado_por, equipamentos ( id, nome ), obras ( id, nome ), tipos_combustivel ( id, nome )');

      if (q.de) query = query.gte('data', q.de);
      if (q.ate) query = query.lte('data', q.ate);
      if (q.equipamento_id) query = query.eq('equipamento_id', q.equipamento_id);
      if (q.obra_id) query = query.eq('obra_id', q.obra_id);
      if (q.tipo_combustivel_id) query = query.eq('tipo_combustivel_id', q.tipo_combustivel_id);
      if (q.operador) query = query.ilike('operador', `%${q.operador}%`);

      query = query.order('data', { ascending: true }).order('created_at', { ascending: true });

      const { data, error } = await query;
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // qualquer usuario logado (admin ou operador) pode lancar abastecimento
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const payload = sanitize(body);
      // se não veio obra (caso do Operador, que não escolhe mais isso na
      // tela dele), usa a obra padrão configurada pelo Administrador.
      if (!payload.obra_id) payload.obra_id = await obraPadraoId(supabase);

      // valida os campos que não dependem do marcador — o marcador em si
      // (e a checagem de duplicado) é resolvido de forma travada dentro
      // da função do banco, mais abaixo.
      if (!payload.data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Data é obrigatória.' }) };
      if (!payload.obra_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Obra é obrigatória.' }) };
      if (!payload.equipamento_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Equipamento é obrigatório.' }) };
      if (!payload.tipo_combustivel_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Tipo de combustível é obrigatório.' }) };
      if (!payload.operador) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Operador/motorista é obrigatório.' }) };
      if (payload.litros === undefined || payload.litros === null || isNaN(payload.litros) || payload.litros <= 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Litros de saída deve ser maior que zero.' }) };
      }

      const clientRef = body.client_ref || null;

      // Função travada no banco: busca o marcador anterior, calcula o novo
      // e salva o lançamento numa operação só — mesmo que dois lançamentos
      // cheguem exatamente ao mesmo tempo, o banco garante que um espera
      // o outro terminar, sem nenhum risco de os dois lerem o mesmo
      // marcador "antigo" e quebrar a corrente.
      const { data, error } = await supabase.rpc('inserir_lancamento_combustivel', {
        p_data: payload.data,
        p_hora: payload.hora,
        p_operador: payload.operador,
        p_obra_id: payload.obra_id,
        p_equipamento_id: payload.equipamento_id,
        p_tipo_combustivel_id: payload.tipo_combustivel_id,
        p_marcador_inicial: payload.marcador_inicial,
        p_litros: payload.litros,
        p_km_hora: payload.km_hora,
        p_criado_por: auth.profile.id,
        p_client_ref: clientRef
      });
      if (error) throw error;
      return { statusCode: 201, headers, body: JSON.stringify(data) };
    }

    // editar: agora exclusivo do Administrador (nem Operador Avançado, nem
    // Operador — mesmo o que ele mesmo criou — podem mais editar).
    if (event.httpMethod === 'PUT') {
      if (auth.profile.role !== 'admin') return forbidden('Apenas o administrador pode editar lançamentos.');
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      const body = JSON.parse(event.body || '{}');
      const payload = sanitize(body);
      const errMsg = validate(payload);
      if (errMsg) return { statusCode: 400, headers, body: JSON.stringify({ error: errMsg }) };

      // Função travada no banco: atualiza este lançamento e recalcula em
      // cascata TODOS os lançamentos seguintes (por data), encadeando o
      // marcador certinho — evita a corrente quebrar quando se edita um
      // lançamento no meio da lista. Mesma trava usada ao criar um novo
      // lançamento, então nunca corre risco mesmo se as duas coisas
      // acontecerem ao mesmo tempo.
      const { data, error } = await supabase.rpc('editar_lancamento_combustivel_cascata', {
        p_id: id,
        p_data: payload.data,
        p_hora: payload.hora,
        p_operador: payload.operador,
        p_obra_id: payload.obra_id,
        p_equipamento_id: payload.equipamento_id,
        p_tipo_combustivel_id: payload.tipo_combustivel_id,
        p_marcador_inicial: payload.marcador_inicial,
        p_litros: payload.litros,
        p_km_hora: payload.km_hora,
        p_atualizado_por: auth.profile.id
      });
      if (error) {
        if (error.message && error.message.includes('não encontrado')) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Lançamento não encontrado.' }) };
        }
        throw error;
      }
      if (!data || data.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Lançamento não encontrado.' }) };
      }
      // data[0] é o lançamento editado; os demais (se houver) são os que
      // foram recalculados em cascata, na ordem.
      return { statusCode: 200, headers, body: JSON.stringify({ ...data[0], _atualizadosEmCascata: data.length }) };
    }

    // excluir: agora exclusivo do Administrador.
    if (event.httpMethod === 'DELETE') {
      if (auth.profile.role !== 'admin') return forbidden('Apenas o administrador pode excluir lançamentos.');
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id é obrigatório.' }) };
      const { error } = await supabase.from('lancamentos').delete().eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
