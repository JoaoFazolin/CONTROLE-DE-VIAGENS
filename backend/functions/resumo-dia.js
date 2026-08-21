const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight } = require('../lib/http');

// GET /api/resumo-dia?data=YYYY-MM-DD
// Soma total de viagens do dia e conta motoristas distintos que trabalharam.
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  if (event.httpMethod !== 'GET') return json(405, { erro: 'Método não permitido.' });

  const auth = await requireAuth(event);
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  const dataParam = event.queryStringParameters?.data;
  if (!dataParam) return json(400, { erro: 'Informe "data".' });

  const supabase = getSupabaseAdmin();
  let query = supabase.from('viagens').select('total_viagens, motorista_id, diesel_litros').eq('data', dataParam);
  if (auth.user.role !== 'admin') query = query.eq('motorista_id', auth.user.id);

  const { data, error } = await query;
  if (error) return json(500, { erro: 'Erro ao calcular resumo.', detalhe: error.message });

  const totalViagens = data.reduce((soma, linha) => soma + (linha.total_viagens || 0), 0);
  const totalDiesel = data.reduce((soma, linha) => soma + (Number(linha.diesel_litros) || 0), 0);
  const motoristasDistintos = new Set(data.map((linha) => linha.motorista_id)).size;

  return json(200, {
    data: dataParam,
    total_viagens: totalViagens,
    total_diesel_litros: Math.round(totalDiesel * 100) / 100,
    motoristas_distintos: motoristasDistintos,
    registros: data.length,
  });
};
