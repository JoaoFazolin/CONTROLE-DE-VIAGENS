const ExcelJS = require('exceljs');
const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight } = require('../lib/http');

// GET /api/relatorio-excel?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
// Gera um .xlsx com todas as viagens do período + uma aba de totais por dia.
// Só admin. Devolve o arquivo em base64 (isBase64Encoded: true) — o
// frontend transforma isso num Blob e dispara o download.
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  if (event.httpMethod !== 'GET') return json(405, { erro: 'Método não permitido.' });

  const auth = await requireAuth(event, { adminOnly: true });
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  const { inicio, fim } = event.queryStringParameters || {};
  if (!inicio || !fim) return json(400, { erro: 'Informe "inicio" e "fim".' });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('viagens')
    .select(
      `data, ordem, total_viagens, diesel_litros, registrado_em,
       caminhao:caminhoes(codigo),
       escavadeira:escavadeiras(codigo),
       local_carga:locais_carga(nome),
       destino:destinos(codigo, descricao),
       motorista:profiles!viagens_motorista_id_fkey(nome)`
    )
    .gte('data', inicio)
    .lte('data', fim)
    .order('data', { ascending: true })
    .order('ordem', { ascending: true });

  if (error) return json(500, { erro: 'Erro ao buscar viagens.', detalhe: error.message });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LR Controle de Viagens';
  workbook.created = new Date();

  // --- Aba 1: viagens detalhadas ---
  const sheet = workbook.addWorksheet('Viagens');
  sheet.columns = [
    { header: 'Data', key: 'data', width: 12 },
    { header: 'Ordem', key: 'ordem', width: 8 },
    { header: 'Caminhão', key: 'caminhao', width: 12 },
    { header: 'Escavadeira', key: 'escavadeira', width: 12 },
    { header: 'Local da Carga', key: 'local', width: 20 },
    { header: 'Destino', key: 'destino', width: 12 },
    { header: 'Descrição Destino', key: 'destino_desc', width: 22 },
    { header: 'Total de Viagens', key: 'total_viagens', width: 14 },
    { header: 'Diesel (L)', key: 'diesel', width: 10 },
    { header: 'Motorista', key: 'motorista', width: 18 },
    { header: 'Registrado em', key: 'registrado_em', width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const v of data) {
    sheet.addRow({
      data: v.data,
      ordem: v.ordem,
      caminhao: v.caminhao?.codigo || '',
      escavadeira: v.escavadeira?.codigo || '',
      local: v.local_carga?.nome || '',
      destino: v.destino?.codigo || '',
      destino_desc: v.destino?.descricao || '',
      total_viagens: v.total_viagens,
      diesel: v.diesel_litros || '',
      motorista: v.motorista?.nome || '',
      registrado_em: new Date(v.registrado_em).toLocaleString('pt-BR'),
    });
  }

  // --- Aba 2: totais por dia ---
  const porDia = new Map();
  for (const v of data) {
    const atual = porDia.get(v.data) || { totalViagens: 0, totalDiesel: 0, motoristas: new Set() };
    atual.totalViagens += v.total_viagens || 0;
    atual.totalDiesel += Number(v.diesel_litros) || 0;
    atual.motoristas.add(v.motorista?.nome || '');
    porDia.set(v.data, atual);
  }

  const resumoSheet = workbook.addWorksheet('Totais por Dia');
  resumoSheet.columns = [
    { header: 'Data', key: 'data', width: 12 },
    { header: 'Total de Viagens', key: 'total_viagens', width: 16 },
    { header: 'Diesel Total (L)', key: 'diesel', width: 16 },
    { header: 'Motoristas Distintos', key: 'motoristas', width: 18 },
  ];
  resumoSheet.getRow(1).font = { bold: true };

  for (const [dia, totais] of [...porDia.entries()].sort()) {
    resumoSheet.addRow({
      data: dia,
      total_viagens: totais.totalViagens,
      diesel: Math.round(totais.totalDiesel * 100) / 100,
      motoristas: totais.motoristas.size,
    });
  }

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
};
