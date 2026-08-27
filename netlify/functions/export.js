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
      .from('lancamentos')
      .select('data, hora, operador, marcador_inicial, marcador_final, litros, km_hora, equipamentos ( nome ), obras ( nome ), tipos_combustivel ( nome )');

    if (q.de) query = query.gte('data', q.de);
    if (q.ate) query = query.lte('data', q.ate);
    if (q.equipamento_id) query = query.eq('equipamento_id', q.equipamento_id);
    if (q.obra_id) query = query.eq('obra_id', q.obra_id);
    if (q.tipo_combustivel_id) query = query.eq('tipo_combustivel_id', q.tipo_combustivel_id);
    if (q.operador) query = query.ilike('operador', `%${q.operador}%`);
    query = query.order('data', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'L.R Campos Cia & Ltda';
    workbook.created = new Date();

    // ---------- Sheet 1: Lancamentos ----------
    const sheet = workbook.addWorksheet('Lancamentos', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Data', key: 'data', width: 12 },
      { header: 'Hora', key: 'hora', width: 10 },
      { header: 'Obra', key: 'obra', width: 22 },
      { header: 'Equipamento', key: 'equipamento', width: 18 },
      { header: 'Combustível', key: 'combustivel', width: 14 },
      { header: 'Operador/Motorista', key: 'operador', width: 24 },
      { header: 'Marcador Inicial', key: 'marcInicial', width: 16 },
      { header: 'Marcador Final', key: 'marcFinal', width: 16 },
      { header: 'Litros Saida', key: 'litros', width: 14 },
      { header: 'Km/Hora', key: 'kmhora', width: 12 }
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
        combustivel: l.tipos_combustivel ? l.tipos_combustivel.nome : '',
        operador: l.operador,
        marcInicial: l.marcador_inicial,
        marcFinal: l.marcador_final,
        litros: l.litros,
        kmhora: l.km_hora
      });
    });

    sheet.getColumn('data').numFmt = 'dd/mm/yyyy';
    sheet.getColumn('litros').numFmt = '#,##0.00';
    // Marcador Inicial/Final e Km/Hora (horímetro): sem formatação de
    // milhar/decimal — aparecem exatamente como foram digitados/calculados
    // (ex: 162662, não 162.662,00).
    ['marcInicial', 'marcFinal', 'kmhora'].forEach((key) => {
      sheet.getColumn(key).numFmt = 'General';
    });

    const lastRow = data.length + 1;
    if (data.length > 0) {
      sheet.autoFilter = { from: 'A1', to: `J${lastRow}` };

      const totalRow = sheet.addRow({
        equipamento: '',
        operador: 'TOTAL',
        litros: { formula: `SUM(I2:I${lastRow})` }
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
        litros: { formula: `SUMIF('Lancamentos'!D:D,A${rowNum},'Lancamentos'!I:I)` },
        qtde: { formula: `COUNTIF('Lancamentos'!D:D,A${rowNum})` },
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

    // ---------- Sheet 3: Resumo por Combustivel ----------
    const resumoComb = workbook.addWorksheet('Resumo por Combustivel');
    resumoComb.columns = [
      { header: 'Combustível', key: 'combustivel', width: 18 },
      { header: 'Litros Total', key: 'litros', width: 16 }
    ];
    resumoComb.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14202B' } };
    });
    const combustiveisUnicos = [...new Set(data.map((l) => (l.tipos_combustivel ? l.tipos_combustivel.nome : 'Sem tipo')))].sort();
    combustiveisUnicos.forEach((nome, idx) => {
      const rowNum = idx + 2;
      const row = resumoComb.addRow({
        combustivel: nome,
        litros: { formula: `SUMIF('Lancamentos'!E:E,A${rowNum},'Lancamentos'!I:I)` }
      });
      row.getCell('litros').numFmt = '#,##0.00';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `relatorio-combustivel-${q.de || 'inicio'}_a_${q.ate || 'hoje'}.xlsx`;

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
