const PDFDocument = require('pdfkit');
const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight, comTratamentoDeErro } = require('../lib/http');

// Mesmo motivo do relatorio-excel.js: a function roda em UTC, então
// qualquer hora precisa ser fixada no fuso de Brasília na hora de formatar,
// senão sai 2-3h errada mesmo com o dado certo no banco.
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
function formatarHoraBR(isoString) {
  return new Date(isoString).toLocaleString('pt-BR', {
    timeZone: FUSO_HORARIO,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
function formatarDataCurtaBR(iso) {
  const [ano, mes, dia] = String(iso).split('-');
  return `${dia}/${mes}/${ano}`;
}

// GET /api/relatorio-pdf?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
// Mesma consulta e mesmos filtros do relatorio-excel.js, mas gera um PDF
// paisagem A4 com as duas tabelas: "Resumo do dia" (agrupado) e "Resumo de
// cada caminhão" (detalhado, uma linha por viagem). Desenho de tabela
// manual (pdfkit não tem tabela pronta), com cabeçalho repetido a cada
// quebra de página. Só admin.
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

  if (caminhaoIdFiltro) query = query.eq('caminhao_id', caminhaoIdFiltro);
  if (motoristaIdFiltro) query = query.eq('motorista_id', motoristaIdFiltro);
  if (destinoIdFiltro) query = query.eq('destino_id', destinoIdFiltro);

  const { data, error } = await query;
  if (error) return json(500, { erro: 'Erro ao buscar viagens.', detalhe: error.message });

  // --- Agrupamento igual ao "Resumo do dia" do Excel.
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

  const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 24 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const pdfPronto = new Promise((resolve) => doc.on('end', resolve));

  const margemX = doc.page.margins.left;

  function desenharTabela(titulo, colunas, linhas) {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0b2545').text(titulo, margemX);
    doc.moveDown(0.3);
    const alturaLinha = 16;
    const larguraTotal = colunas.reduce((s, c) => s + c.width, 0);
    let y = doc.y;

    function cabecalho() {
      doc.rect(margemX, y, larguraTotal, alturaLinha).fill('#0b2545');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
      let cx = margemX;
      for (const c of colunas) {
        doc.text(c.header, cx + 3, y + 4, { width: c.width - 6, height: alturaLinha - 4, ellipsis: true, lineBreak: false });
        cx += c.width;
      }
      y += alturaLinha;
    }

    cabecalho();
    let zebra = false;
    for (const linha of linhas) {
      if (y + alturaLinha > doc.page.height - doc.page.margins.bottom) {
        doc.addPage({ layout: 'landscape', size: 'A4', margin: 24 });
        y = doc.page.margins.top;
        cabecalho();
      }
      if (zebra) {
        doc.rect(margemX, y, larguraTotal, alturaLinha).fill('#f2f4f8');
      }
      zebra = !zebra;
      doc.font('Helvetica').fontSize(7.5).fillColor('#111111');
      let cx = margemX;
      for (const c of colunas) {
        const valor = linha[c.key];
        doc.text(valor === null || valor === undefined ? '' : String(valor), cx + 3, y + 4, {
          width: c.width - 6,
          height: alturaLinha - 4,
          ellipsis: true,
          lineBreak: false,
        });
        cx += c.width;
      }
      y += alturaLinha;
    }
    doc.y = y + 14;
  }

  // --- Cabeçalho do relatório.
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0b2545').text('LR Campos Cia & Ltda — Relatório de Viagens', margemX, doc.page.margins.top);
  doc.font('Helvetica').fontSize(10).fillColor('#333333').text(`Período: ${formatarDataCurtaBR(inicio)} a ${formatarDataCurtaBR(fim)}`);
  doc.moveDown(0.8);

  // --- Tabela 1: Resumo do dia.
  const colunasResumoDia = [
    { header: 'Data', key: 'data', width: 55 },
    { header: 'Caminhão', key: 'caminhao', width: 60 },
    { header: 'Escavadeira', key: 'escavadeira', width: 65 },
    { header: 'Local de Carga/Corte', key: 'local', width: 110 },
    { header: 'Destino', key: 'destino', width: 55 },
    { header: 'Descrição Destino', key: 'destino_desc', width: 120 },
    { header: 'Viagens', key: 'viagens', width: 50 },
    { header: 'Volume/Viagem', key: 'volume_por_viagem', width: 80 },
    { header: 'Volume no Aterro', key: 'volume_aterro', width: 85 },
  ];
  const linhasResumoDia = [...grupos.values()]
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.caminhao.localeCompare(b.caminhao)))
    .map((g) => ({
      data: formatarDataCurtaBR(g.data),
      caminhao: g.caminhao,
      escavadeira: g.escavadeira,
      local: g.local,
      destino: g.destino,
      destino_desc: g.destino_desc,
      viagens: g.viagens,
      volume_por_viagem: g.volumePorViagem ?? '',
      volume_aterro: g.volumePorViagem != null ? Math.round(g.volumePorViagem * g.viagens * 100) / 100 : '',
    }));
  desenharTabela('Resumo do dia', colunasResumoDia, linhasResumoDia);

  // --- Tabela 2: Resumo de cada caminhão (detalhado), sempre em página nova.
  doc.addPage({ layout: 'landscape', size: 'A4', margin: 24 });
  const colunasDetalhado = [
    { header: 'Operador', key: 'operador', width: 78 },
    { header: 'Data', key: 'data', width: 50 },
    { header: 'Ordem', key: 'ordem', width: 35 },
    { header: 'Caminhão', key: 'caminhao', width: 50 },
    { header: 'Motorista', key: 'motorista', width: 78 },
    { header: 'Escavadeira', key: 'escavadeira', width: 58 },
    { header: 'Local Carga/Corte', key: 'local', width: 85 },
    { header: 'Destino', key: 'destino', width: 45 },
    { header: 'Descr. Destino', key: 'destino_desc', width: 85 },
    { header: 'Total Viag.', key: 'total_viagens', width: 45 },
    { header: 'Horário', key: 'horario', width: 48 },
    { header: 'Registrado em', key: 'registrado_em', width: 95 },
  ];
  const linhasDetalhado = data.map((v) => ({
    operador: v.operador?.nome || '',
    data: formatarDataCurtaBR(v.data),
    ordem: v.ordem,
    caminhao: v.caminhao?.codigo || '',
    motorista: v.motorista?.nome || '',
    escavadeira: v.escavadeira?.codigo || '',
    local: v.local_carga?.nome || '',
    destino: v.destino?.codigo || '',
    destino_desc: v.destino?.descricao || '',
    total_viagens: v.total_viagens,
    horario: formatarHoraBR(v.registrado_em),
    registrado_em: formatarDataHoraBR(v.registrado_em),
  }));
  desenharTabela('Resumo de cada caminhão', colunasDetalhado, linhasDetalhado);

  doc.end();
  await pdfPronto;
  const buffer = Buffer.concat(chunks);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="viagens_${inicio}_a_${fim}.pdf"`,
      'Access-Control-Allow-Origin': '*',
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
});
