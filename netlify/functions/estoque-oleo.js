const { getSupabase } = require('./lib/supabase');
const { requireAuth, unauthorized } = require('./lib/authGuard');

exports.handler = async (event) => {
  const auth = await requireAuth(event);
  if (!auth) return unauthorized();

  const headers = { 'Content-Type': 'application/json' };
  const supabase = getSupabase();

  try {
    const { data: tipos, error: errTipos } = await supabase.from('tipos_oleo').select('*').order('nome');
    if (errTipos) throw errTipos;

    const { data: entradas, error: errEnt } = await supabase.from('entradas_oleo').select('tipo_oleo_id, litros');
    if (errEnt) throw errEnt;

    const { data: saidas, error: errSai } = await supabase.from('lancamentos_oleo').select('tipo_oleo_id, litros');
    if (errSai) throw errSai;

    const totalEntradas = {};
    entradas.forEach((e) => {
      const k = e.tipo_oleo_id || 'sem_tipo';
      totalEntradas[k] = (totalEntradas[k] || 0) + (Number(e.litros) || 0);
    });

    const totalSaidas = {};
    saidas.forEach((s) => {
      const k = s.tipo_oleo_id || 'sem_tipo';
      totalSaidas[k] = (totalSaidas[k] || 0) + (Number(s.litros) || 0);
    });

    const resultado = tipos.map((t) => {
      const entrou = totalEntradas[t.id] || 0;
      const saiu = totalSaidas[t.id] || 0;
      const saldo = entrou - saiu;
      return {
        id: t.id,
        nome: t.nome,
        estoqueMinimo: Number(t.estoque_minimo) || 0,
        totalEntradas: entrou,
        totalSaidas: saiu,
        saldoAtual: saldo,
        abaixoDoMinimo: saldo < (Number(t.estoque_minimo) || 0)
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify(resultado) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
