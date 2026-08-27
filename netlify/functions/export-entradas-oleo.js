const ExcelJS = require('exceljs');
const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized } = require('./lib/authGuard');

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();

  const supabase = getSupabase();

  try {
    const q = event.queryStringParameters || {};
    let query = supabase
      .from('entradas_oleo')
      .select('data, litros, fornecedor, nota_fiscal, observacao, tipos_oleo ( nome )');

    if (q.de) query = query.gte('data', q.de);
    if (q.ate) query = query.lte('data', q.ate);
    if (q.tipo_oleo_id) query = query.eq('tipo_oleo_id', q.tipo_oleo_id);
    query = query.order('data', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'L.R Campos Cia & Ltda';
    workbook.created = new Date();

    // ---------- Sheet 1: Entradas ----------
    const sheet = workbook.addWorksheet('Entradas', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Data', key: 'data', width: 12 },
      { header: 'Tipo de Lubrificante', key: 'oleo', width: 20 },
      { header: 'Litros Recebidos', key: 'litros', width: 16 },
      { header: 'Fornecedor', key: 'fornecedor', width: 24 },
      { header: 'Nota Fiscal', key: 'notaFiscal', width: 16 },
      { header: 'Observação', key: 'observacao', width: 30 }
    ];

    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14202B' } };
      cell.alignment = { vertical: 'middle' };
    });

    data.forEach((e) => {
      sheet.addRow({
        data: e.data ? new Date(e.data + 'T00:00:00') : null,
        oleo: e.tipos_oleo ? e.tipos_oleo.nome : '',
        litros: e.litros,
        fornecedor: e.fornecedor || '',
        notaFiscal: e.nota_fiscal || '',
        observacao: e.observacao || ''
      });
    });

    sheet.getColumn('data').numFmt = 'dd/mm/yyyy';
    sheet.getColumn('litros').numFmt = '#,##0.00';

    const lastRow = data.length + 1;
    if (data.length > 0) {
      sheet.autoFilter = { from: 'A1', to: `F${lastRow}` };

      const totalRow = sheet.addRow({
        oleo: '',
        fornecedor: 'TOTAL',
        litros: { formula: `SUM(C2:C${lastRow})` }
      });
      totalRow.font = { bold: true };
      totalRow.getCell('litros').numFmt = '#,##0.00';
    }

    // ---------- Sheet 2: Resumo por Tipo de Lubrificante ----------
    const resumo = workbook.addWorksheet('Resumo por Tipo de Lubrificante');
    resumo.columns = [
      { header: 'Tipo de Lubrificante', key: 'oleo', width: 20 },
      { header: 'Litros Recebidos', key: 'litros', width: 18 }
    ];
    resumo.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14202B' } };
    });

    const oleosUnicos = [...new Set(data.map((e) => (e.tipos_oleo ? e.tipos_oleo.nome : 'Sem tipo')))].sort();
    oleosUnicos.forEach((nome, idx) => {
      const rowNum = idx + 2;
      const row = resumo.addRow({
        oleo: nome,
        litros: { formula: `SUMIF('Entradas'!B:B,A${rowNum},'Entradas'!C:C)` }
      });
      row.getCell('litros').numFmt = '#,##0.00';
    });

    if (oleosUnicos.length > 0) {
      const lastResumoRow = oleosUnicos.length + 1;
      const totalResumo = resumo.addRow({
        oleo: 'TOTAL GERAL',
        litros: { formula: `SUM(B2:B${lastResumoRow})` }
      });
      totalResumo.font = { bold: true };
      totalResumo.getCell('litros').numFmt = '#,##0.00';
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `entradas-estoque-oleo-${q.de || 'inicio'}_a_${q.ate || 'hoje'}.xlsx`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
