const ExcelJS = require('exceljs');
const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight, comTratamentoDeErro } = require('../lib/http');

// A function da Netlify roda em UTC, não no fuso do Brasil — então formatar
// a hora sem fixar o fuso faria o Excel sair com a hora errada (2-3h de
// diferença), mesmo o dado no banco estando certo (é o `registrado_em`
// capturado no aparelho do motorista, no momento do lançamento — nunca a
// hora que sincronizou). Fixamos aqui pra sempre sair no horário de
// Brasília, com segundos, não importa em que fuso o servidor está rodando.
const FUSO_HORARIO = 'America/Sao_Paulo';
function formatarDataHoraBR(isoString) {
  return new Date(isoString).toLocaleString('pt-BR', {
    timeZone: FUSO_HORARIO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// O Excel não guarda fuso horário — uma célula de hora é só um número "cru"
// (fração do dia), sem timezone junto. Se a gente passar o Date de verdade
// pro ExcelJS, ele serializa usando os componentes em UTC, então o Excel
// mostraria a hora em UTC, não a hora de Brasília. Pra a célula aparecer
// certinho como "13:30:45" (com o formato de hora do Excel, não texto),
// construímos um Date "disfarçado": pegamos a hora de Brasília e criamos um
// Date cujos componentes UTC são exatamente esses — assim o serial do Excel
// bate com o horário certo, não importa o fuso de quem abrir a planilha.
function paraCelulaHorarioBR(isoString) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_HORARIO,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(new Date(isoString))
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const hora = partes.hour === '24' ? '0' : partes.hour; // Intl às vezes devolve "24" pra meia-noite
  return new Date(Date.UTC(1970, 0, 1, Number(hora), Number(partes.minute), Number(partes.second)));
}

// GET /api/relatorio-excel?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
// Gera um .xlsx com duas abas: "Resumo do dia" (agrupado por caminhão/
// escavadeira/corte/destino, somando viagens e volume) e "Resumo de cada
// caminhão" (uma linha por viagem, com filtro do Excel ligado). Só admin.
// Devolve o arquivo em base64 (isBase64Encoded: true) — o frontend
// transforma isso num Blob e dispara o download.
exports.handler = comTratamentoDeErro(async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  if (event.httpMethod !== 'GET') return json(405, { erro: 'Método não permitido.' });

  const auth = await requireAuth(event, { gerenciaOnly: true });
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  const {
    inicio,
    fim,
    caminhao_id: caminhaoIdFiltro,
    motorista_id: motoristaIdFiltro,
    destino_id: destinoIdFiltro,
  } = event.queryStringParameters || {};
  if (!inicio || !fim) return json(400, { erro: 'Informe "inicio" e "fim".' });

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('viagens')
    .select(
      `data, ordem, total_viagens, registrado_em,
       caminhao:caminhoes(codigo, volume_aterro),
       escavadeira:escavadeiras(codigo),
       local_carga:locais_carga(nome),
       destino:destinos(codigo, descricao),
       motorista:profiles!viagens_motorista_id_fkey(nome),
       operador:profiles!viagens_criado_por_fkey(nome)`
    )
    .gte('data', inicio)
    .lte('data', fim)
    .order('data', { ascending: true })
    .order('ordem', { ascending: true });

  // Filtros opcionais — sem eles, o relatório sai geral (todos os
  // caminhões e motoristas juntos, que é o padrão mais usado).
  if (caminhaoIdFiltro) query = query.eq('caminhao_id', caminhaoIdFiltro);
  if (motoristaIdFiltro) query = query.eq('motorista_id', motoristaIdFiltro);
  if (destinoIdFiltro) query = query.eq('destino_id', destinoIdFiltro);

  const { data, error } = await query;

  if (error) return json(500, { erro: 'Erro ao buscar viagens.', detalhe: error.message });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LR Controle de Viagens';
  workbook.created = new Date();

  // --- Aba 1: "Resumo do dia" — agrupado por Data + Caminhão + Escavadeira
  // + Local de carga/corte + Destino, somando as viagens de cada grupo.
  // "Volume por viagem" vem do cadastro do caminhão (Volume no Aterro 38%,
  // digitado manualmente pelo admin); "Volume no Aterro" é o total do grupo
  // (viagens × volume por viagem). Fica em branco quando o caminhão não tem
  // volume cadastrado, em vez de mostrar 0 (que enganaria a soma).
  const grupos = new Map();
  for (const v of data) {
    const chave = [v.data, v.caminhao?.codigo || '', v.escavadeira?.codigo || '', v.local_carga?.nome || '', v.destino?.codigo || ''].join('|');
    const atual = grupos.get(chave) || {
      data: v.data,
      caminhao: v.caminhao?.codigo || '',
      escavadeira: v.escavadeira?.codigo || '',
      local: v.local_carga?.nome || '',
      destino: v.destino?.codigo || '',
      destino_desc: v.destino?.descricao || '',
      viagens: 0,
      volumePorViagem: v.caminhao?.volume_aterro ?? null,
    };
    atual.viagens += v.total_viagens || 0;
    grupos.set(chave, atual);
  }

  const resumoDiaSheet = workbook.addWorksheet('Resumo do dia');
  resumoDiaSheet.columns = [
    { header: 'Data', key: 'data', width: 12 },
    { header: 'Caminhão', key: 'caminhao', width: 12 },
    { header: 'Escavadeira', key: 'escavadeira', width: 12 },
    { header: 'Local de Carga/Corte', key: 'local', width: 20 },
    { header: 'Destino', key: 'destino', width: 12 },
    { header: 'Descrição Destino', key: 'destino_desc', width: 22 },
    { header: 'Viagens', key: 'viagens', width: 10 },
    { header: 'Volume por Viagem', key: 'volume_por_viagem', width: 16 },
    { header: 'Volume no Aterro', key: 'volume_aterro', width: 16 },
  ];
  resumoDiaSheet.getRow(1).font = { bold: true };

  for (const g of [...grupos.values()].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.caminhao.localeCompare(b.caminhao)))) {
    const volumeTotal = g.volumePorViagem != null ? Math.round(g.volumePorViagem * g.viagens * 100) / 100 : '';
    resumoDiaSheet.addRow({
      data: g.data,
      caminhao: g.caminhao,
      escavadeira: g.escavadeira,
      local: g.local,
      destino: g.destino,
      destino_desc: g.destino_desc,
      viagens: g.viagens,
      volume_por_viagem: g.volumePorViagem ?? '',
      volume_aterro: volumeTotal,
    });
  }
  resumoDiaSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: resumoDiaSheet.columns.length } };

  // --- Aba 2: "Resumo de cada caminhão" — uma linha por viagem. "Operador"
  // (quem lançou — o operador da escavadeira, logado no app) vai na
  // primeira coluna, antes da Data; "Motorista" (quem dirigiu aquela carga
  // — escolhido a cada lançamento, pode mudar se o motorista fixo daquele
  // caminhão faltar) vai logo depois do Caminhão. Filtro do Excel ligado em
  // todas as colunas, pra filtrar direto na planilha.
  const sheet = workbook.addWorksheet('Resumo de cada caminhão');
  sheet.columns = [
    { header: 'Operador', key: 'operador', width: 18 },
    { header: 'Data', key: 'data', width: 12 },
    { header: 'Ordem', key: 'ordem', width: 8 },
    { header: 'Caminhão', key: 'caminhao', width: 12 },
    { header: 'Motorista', key: 'motorista', width: 18 },
    { header: 'Escavadeira', key: 'escavadeira', width: 12 },
    { header: 'Local de Carga/Corte', key: 'local', width: 20 },
    { header: 'Destino', key: 'destino', width: 12 },
    { header: 'Descrição Destino', key: 'destino_desc', width: 22 },
    { header: 'Total de Viagens', key: 'total_viagens', width: 14 },
    { header: 'Horário', key: 'horario', width: 12 },
    { header: 'Registrado em', key: 'registrado_em', width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const v of data) {
    const linha = sheet.addRow({
      operador: v.operador?.nome || '',
      data: v.data,
      ordem: v.ordem,
      caminhao: v.caminhao?.codigo || '',
      motorista: v.motorista?.nome || '',
      escavadeira: v.escavadeira?.codigo || '',
      local: v.local_carga?.nome || '',
      destino: v.destino?.codigo || '',
      destino_desc: v.destino?.descricao || '',
      total_viagens: v.total_viagens,
      registrado_em: formatarDataHoraBR(v.registrado_em),
    });
    // Célula de hora "de verdade" (não texto) — aparece como 13:30:45 e
    // pode ser usada em fórmula/ordenação, sem depender do fuso de quem
    // abrir a planilha.
    const celulaHorario = linha.getCell('horario');
    celulaHorario.value = paraCelulaHorarioBR(v.registrado_em);
    celulaHorario.numFmt = 'hh:mm:ss';
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  const buffer = await workbook.xlsx.writeBuffer();

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="viagens_${inicio}_a_${fim}.xlsx"`,
      'Access-Control-Allow-Origin': '*',
    },
    body: Buffer.from(buffer).toString('base64'),
    isBase64Encoded: true,
  };
});
