const ExcelJS = require('exceljs');
const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized, forbidden, podeGerenciar } = require('./lib/authGuard');

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();
  if (!podeGerenciar(auth.profile)) return forbidden('Apenas administradores e operadores avançados podem exportar relatórios.');

  const supabase = getSupabase();

  try {
    const q = event.queryStringParameters || {};
    let query = supabase
      .from('lancamentos_oleo')
      .select('data, hora, operador, litros, equipamentos ( nome ), obras ( nome ), tipos_oleo ( nome )');

    if (q.de) query = query.gte('data', q.de);
    if (q.ate) query = query.lte('data', q.ate);
    if (q.equipamento_id) query = query.eq('equipamento_id', q.equipamento_id);
    if (q.obra_id) query = query.eq('obra_id', q.obra_id);
    if (q.tipo_oleo_id) query = query.eq('tipo_oleo_id', q.tipo_oleo_id);
    if (q.operador) query = query.ilike('operador', `%${q.operador}%`);
    query = query.order('data', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'L.R Campos Cia & Ltda';
    workbook.created = new Date();

    // ---------- Sheet 1: Lancamentos ----------
    const sheet = workbook.addWorksheet('Lancamentos Lubrificante', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Data', key: 'data', width: 12 },
      { header: 'Hora', key: 'hora', width: 10 },
      { header: 'Obra', key: 'obra', width: 22 },
      { header: 'Equipamento', key: 'equipamento', width: 18 },
      { header: 'Tipo de Lubrificante', key: 'oleo', width: 20 },
      { header: 'Operador/Motorista', key: 'operador', width: 24 },
      { header: 'Litros Usados', key: 'litros', width: 14 }
    ];

    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14202B' } };
      cell.alignment = { vertical: 'middle' };
    });

    data.forEach((l) => {
      sheet.addRow({
        data: l.data ? new Date(l.data + 'T00:00:00') : null,
        hora: l.hora || '',
        obra: l.obras ? l.obras.nome : '',
        equipamento: l.equipamentos ? l.equipamentos.nome : '',
        oleo: l.tipos_oleo ? l.tipos_oleo.nome : '',
        operador: l.operador,
        litros: l.litros
      });
    });

    sheet.getColumn('data').numFmt = 'dd/mm/yyyy';
    sheet.getColumn('litros').numFmt = '#,##0.00';

    const lastRow = data.length + 1;
    if (data.length > 0) {
      sheet.autoFilter = { from: 'A1', to: `G${lastRow}` };

      const totalRow = sheet.addRow({
        equipamento: '',
        operador: 'TOTAL',
        litros: { formula: `SUM(G2:G${lastRow})` }
      });
      totalRow.font = { bold: true };
      totalRow.getCell('litros').numFmt = '#,##0.00';
    }

    // ---------- Sheet 2: Resumo por Equipamento ----------
    const resumo = workbook.addWorksheet('Resumo por Equipamento');
    resumo.columns = [
      { header: 'Equipamento', key: 'equipamento', width: 22 },
      { header: 'Litros Total', key: 'litros', width: 16 },
      { header: 'Nº de Lancamentos', key: 'qtde', width: 20 },
      { header: 'Media Litros/Lancamento', key: 'media', width: 24 }
    ];
    resumo.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14202B' } };
    });

    const equipamentosUnicos = [...new Set(data.map((l) => (l.equipamentos ? l.equipamentos.nome : 'Sem equipamento')))].sort();

    equipamentosUnicos.forEach((nome, idx) => {
      const rowNum = idx + 2;
      const row = resumo.addRow({
        equipamento: nome,
        litros: { formula: `SUMIF('Lancamentos Lubrificante'!D:D,A${rowNum},'Lancamentos Lubrificante'!G:G)` },
        qtde: { formula: `COUNTIF('Lancamentos Lubrificante'!D:D,A${rowNum})` },
        media: { formula: `IF(C${rowNum}=0,0,B${rowNum}/C${rowNum})` }
      });
      row.getCell('litros').numFmt = '#,##0.00';
      row.getCell('media').numFmt = '#,##0.00';
    });

    if (equipamentosUnicos.length > 0) {
      const lastResumoRow = equipamentosUnicos.length + 1;
      const totalResumo = resumo.addRow({
        equipamento: 'TOTAL GERAL',
        litros: { formula: `SUM(B2:B${lastResumoRow})` }
      });
      totalResumo.font = { bold: true };
      totalResumo.getCell('litros').numFmt = '#,##0.00';
    }

    // ---------- Sheet 3: Resumo por Tipo de Lubrificante ----------
    const resumoOleo = workbook.addWorksheet('Resumo por Tipo de Lubrificante');
    resumoOleo.columns = [
      { header: 'Tipo de Lubrificante', key: 'oleo', width: 20 },
      { header: 'Litros Total', key: 'litros', width: 16 }
    ];
    resumoOleo.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14202B' } };
    });
    const oleosUnicos = [...new Set(data.map((l) => (l.tipos_oleo ? l.tipos_oleo.nome : 'Sem tipo')))].sort();
    oleosUnicos.forEach((nome, idx) => {
      const rowNum = idx + 2;
      const row = resumoOleo.addRow({
        oleo: nome,
        litros: { formula: `SUMIF('Lancamentos Lubrificante'!E:E,A${rowNum},'Lancamentos Lubrificante'!G:G)` }
      });
      row.getCell('litros').numFmt = '#,##0.00';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `relatorio-oleo-${q.de || 'inicio'}_a_${q.ate || 'hoje'}.xlsx`;

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
