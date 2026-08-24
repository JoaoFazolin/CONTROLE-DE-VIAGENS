const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight, comTratamentoDeErro } = require('../lib/http');

// GET /api/dashboard?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
// Admin e operador_avancado. Agrega as viagens do período pra alimentar os
// gráficos: total geral, viagens por dia, por caminhão e por destino.
exports.handler = comTratamentoDeErro(async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  if (event.httpMethod !== 'GET') return json(405, { erro: 'Método não permitido.' });

  const auth = await requireAuth(event, { gerenciaOnly: true });
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  const { inicio, fim } = event.queryStringParameters || {};
  if (!inicio || !fim) return json(400, { erro: 'Informe "inicio" e "fim".' });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('viagens')
    .select(
      `data, total_viagens, diesel_litros, motorista_id,
       caminhao:caminhoes(codigo),
       destino:destinos(codigo)`
    )
    .gte('data', inicio)
    .lte('data', fim);

  if (error) return json(500, { erro: 'Erro ao calcular dashboard.', detalhe: error.message });

  let totalViagens = 0;
  let totalDiesel = 0;
  const motoristas = new Set();
  const porDiaMap = new Map();
  const porCaminhaoMap = new Map();
  const porDestinoMap = new Map();

  for (const v of data) {
    const qtd = v.total_viagens || 0;
    totalViagens += qtd;
    totalDiesel += Number(v.diesel_litros) || 0;
    motoristas.add(v.motorista_id);

    porDiaMap.set(v.data, (porDiaMap.get(v.data) || 0) + qtd);

    const codigoCaminhao = v.caminhao?.codigo || 'Sem caminhão';
    porCaminhaoMap.set(codigoCaminhao, (porCaminhaoMap.get(codigoCaminhao) || 0) + qtd);

    const codigoDestino = v.destino?.codigo || 'Sem destino';
    porDestinoMap.set(codigoDestino, (porDestinoMap.get(codigoDestino) || 0) + qtd);
  }

  const paraLista = (mapa) =>
    [...mapa.entries()]
      .map(([chave, valor]) => ({ chave, valor }))
      .sort((a, b) => b.valor - a.valor);

  return json(200, {
    inicio,
    fim,
    total_viagens: totalViagens,
    total_diesel_litros: Math.round(totalDiesel * 100) / 100,
    motoristas_distintos: motoristas.size,
    registros: data.length,
    por_dia: [...porDiaMap.entries()].map(([chave, valor]) => ({ chave, valor })).sort((a, b) => a.chave.localeCompare(b.chave)),
    por_caminhao: paraLista(porCaminhaoMap),
    por_destino: paraLista(porDestinoMap),
  });
});
