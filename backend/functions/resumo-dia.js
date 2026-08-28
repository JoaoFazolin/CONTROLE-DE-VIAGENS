const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight, comTratamentoDeErro } = require('../lib/http');

// GET /api/resumo-dia?data=YYYY-MM-DD
// Soma total de viagens do dia, conta motoristas distintos que trabalharam,
// e devolve os dados da última viagem lançada (pra mostrar no card "Última
// viagem: EH 347 carregou CB 124 às 8:30").
exports.handler = comTratamentoDeErro(async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  if (event.httpMethod !== 'GET') return json(405, { erro: 'Método não permitido.' });

  const auth = await requireAuth(event);
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  const dataParam = event.queryStringParameters?.data;
  if (!dataParam) return json(400, { erro: 'Informe "data".' });

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('viagens')
    .select(
      `total_viagens, motorista_id, criado_por, ordem, registrado_em,
       caminhao:caminhoes(codigo),
       escavadeira:escavadeiras(codigo)`
    )
    .eq('data', dataParam);
  // Mesma regra de isolamento do /api/viagens: "motorista" (raro logar) vê
  // só o que ele dirigiu; "operador_avancado" (quem loga na prática) vê só
  // o que ele mesmo lançou, independente de qual motorista escolheu.
  if (auth.user.role === 'motorista') {
    query = query.eq('motorista_id', auth.user.id);
  } else if (auth.user.role !== 'admin') {
    query = query.eq('criado_por', auth.user.id);
  }

  const { data, error } = await query;
  if (error) return json(500, { erro: 'Erro ao calcular resumo.', detalhe: error.message });

  const totalViagens = data.reduce((soma, linha) => soma + (linha.total_viagens || 0), 0);
  const motoristasDistintos = new Set(data.map((linha) => linha.motorista_id)).size;

  // "Última" = maior Ordem do dia (mais confiável que registrado_em pra
  // ordenar, já que Ordem é atribuída em fila, sem risco de empate).
  const ultima = data.reduce((maisRecente, linha) => (!maisRecente || linha.ordem > maisRecente.ordem ? linha : maisRecente), null);

  return json(200, {
    data: dataParam,
    total_viagens: totalViagens,
    motoristas_distintos: motoristasDistintos,
    registros: data.length,
    ultima_viagem: ultima
      ? {
          caminhao: ultima.caminhao?.codigo || null,
          escavadeira: ultima.escavadeira?.codigo || null,
          registrado_em: ultima.registrado_em,
        }
      : null,
  });
});
