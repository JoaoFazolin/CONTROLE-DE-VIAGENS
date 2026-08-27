const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized, forbidden, podeGerenciar } = require('./lib/authGuard');

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();
  if (!podeGerenciar(auth.profile)) return forbidden('Apenas administradores e operadores avançados podem ver o dashboard.');

  const headers = { 'Content-Type': 'application/json' };
  const supabase = getSupabase();

  try {
    const q = event.queryStringParameters || {};
    const periodo = q.periodo === 'mes' ? 'mes' : 'dia';
    const ref = q.data || new Date().toISOString().slice(0, 10);

    let de, ate;
    if (periodo === 'dia') {
      de = ref;
      ate = ref;
    } else {
      const [y, m] = ref.split('-');
      de = `${y}-${m}-01`;
      ate = `${y}-${m}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
    }

    const { data, error } = await supabase
      .from('lancamentos')
      .select('litros, data, equipamento_id, tipo_combustivel_id, equipamentos ( id, nome ), tipos_combustivel ( id, nome )')
      .gte('data', de)
      .lte('data', ate);
    if (error) throw error;

    const porEquipamento = {};
    const porDia = {};
    const porTipo = {};
    let totalLitros = 0;

    data.forEach((l) => {
      const nome = l.equipamentos ? l.equipamentos.nome : 'Sem equipamento';
      const eqId = l.equipamento_id || 'sem_equipamento';
      if (!porEquipamento[eqId]) porEquipamento[eqId] = { equipamentoId: eqId, nome, litros: 0, lancamentos: 0 };
      porEquipamento[eqId].litros += Number(l.litros) || 0;
      porEquipamento[eqId].lancamentos += 1;

      const tipoNome = l.tipos_combustivel ? l.tipos_combustivel.nome : 'Sem tipo';
      const tipoId = l.tipo_combustivel_id || 'sem_tipo';
      if (!porTipo[tipoId]) porTipo[tipoId] = { tipoId, nome: tipoNome, litros: 0 };
      porTipo[tipoId].litros += Number(l.litros) || 0;

      if (!porDia[l.data]) porDia[l.data] = 0;
      porDia[l.data] += Number(l.litros) || 0;

      totalLitros += Number(l.litros) || 0;
    });

    const resultado = {
      periodo,
      de,
      ate,
      totalLitros,
      totalLancamentos: data.length,
      porEquipamento: Object.values(porEquipamento).sort((a, b) => b.litros - a.litros),
      porTipoCombustivel: Object.values(porTipo).sort((a, b) => b.litros - a.litros),
      porDia: Object.keys(porDia).sort().map((d) => ({ data: d, litros: porDia[d] }))
    };

    return { statusCode: 200, headers, body: JSON.stringify(resultado) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
