const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight, comTratamentoDeErro } = require('../lib/http');

// GET /api/dashboard?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
// Só admin. Agrega as viagens do período pra alimentar os gráficos: total
// geral, viagens por dia, por caminhão e por destino. Também detecta
// "anomalias": viagens em que o motorista que rodou é diferente do
// motorista vinculado ao caminhão (ex: substituição por caminhão quebrado,
// motorista de folga etc.) — vira o card "Fora do normal" no Dashboard.
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
      `data, total_viagens, motorista_id,
       caminhao:caminhoes(codigo, motorista_id, motorista_vinculado:profiles!caminhoes_motorista_id_fkey(nome)),
       motorista:profiles!viagens_motorista_id_fkey(nome),
       destino:destinos(codigo)`
    )
    .gte('data', inicio)
    .lte('data', fim);

  if (error) return json(500, { erro: 'Erro ao calcular dashboard.', detalhe: error.message });

  let totalViagens = 0;
  const motoristas = new Set();
  const porDiaMap = new Map();
  const porCaminhaoMap = new Map();
  const porDestinoMap = new Map();
  const anomaliasMap = new Map();

  for (const v of data) {
    const qtd = v.total_viagens || 0;
    totalViagens += qtd;
    motoristas.add(v.motorista_id);

    porDiaMap.set(v.data, (porDiaMap.get(v.data) || 0) + qtd);

    const codigoCaminhao = v.caminhao?.codigo || 'Sem caminhão';
    porCaminhaoMap.set(codigoCaminhao, (porCaminhaoMap.get(codigoCaminhao) || 0) + qtd);

    const codigoDestino = v.destino?.codigo || 'Sem destino';
    porDestinoMap.set(codigoDestino, (porDestinoMap.get(codigoDestino) || 0) + qtd);

    const motoristaVinculadoId = v.caminhao?.motorista_id;
    if (motoristaVinculadoId && motoristaVinculadoId !== v.motorista_id) {
      const chave = `${v.data}|${codigoCaminhao}|${v.motorista_id}`;
      const existente = anomaliasMap.get(chave);
      if (existente) {
        existente.viagens += qtd;
      } else {
        anomaliasMap.set(chave, {
          data: v.data,
          caminhao: codigoCaminhao,
          motorista: v.motorista?.nome || 'Motorista desconhecido',
          motorista_vinculado: v.caminhao?.motorista_vinculado?.nome || 'Sem vínculo',
          viagens: qtd,
        });
      }
    }
  }

  const paraLista = (mapa) =>
    [...mapa.entries()]
      .map(([chave, valor]) => ({ chave, valor }))
      .sort((a, b) => b.valor - a.valor);

  const anomalias = [...anomaliasMap.values()]
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, 30);

  return json(200, {
    inicio,
    fim,
    total_viagens: totalViagens,
    motoristas_distintos: motoristas.size,
    registros: data.length,
    por_dia: [...porDiaMap.entries()].map(([chave, valor]) => ({ chave, valor })).sort((a, b) => a.chave.localeCompare(b.chave)),
    por_caminhao: paraLista(porCaminhaoMap),
    por_destino: paraLista(porDestinoMap),
    anomalias,
  });
});
