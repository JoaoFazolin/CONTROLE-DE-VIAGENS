// CRUD genérico para as tabelas de cadastro simples (caminhoes, escavadeiras,
// locais_carga, destinos): todas têm o mesmo formato — id, um campo texto
// principal, ativo, criado_em. Isso evita repetir a mesma lógica 4x.
const { getSupabaseAdmin } = require('./supabaseAdmin');
const { requireAuth } = require('./auth');
// Escrita permitida só pra admin (gerenciaOnly — ver lib/auth.js).
const { json, noContentPreflight, safeJsonParse } = require('./http');

/**
 * @param {object} event
 * @param {{ table: string, campo: string, campoLabel: string, extras?: string[], mensagensDuplicidade?: object }} config
 *   table: nome da tabela no Postgres
 *   campo: nome da coluna "principal" (codigo | nome)
 *   extras: outras colunas aceitas no POST/PUT (ex: ['descricao'] para destinos)
 *   mensagensDuplicidade: mensagem customizada por coluna quando a violação de
 *     unicidade (23505) não é no campo principal — ex: { motorista_id: '...' }
 *     em caminhões, cujo vínculo motorista→caminhão também é unique. Sem
 *     isso, o erro genérico ("já existe um registro com esse código") ficaria
 *     enganoso quando quem colidiu foi outra coluna.
 */
function mensagemDeDuplicidade(error, campoLabel, mensagensDuplicidade) {
  const texto = `${error.message || ''} ${error.details || ''}`;
  for (const [coluna, mensagem] of Object.entries(mensagensDuplicidade || {})) {
    if (texto.includes(coluna)) return mensagem;
  }
  return `Já existe um registro com esse ${campoLabel}.`;
}
async function handleCrudCadastro(event, config) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  try {
    return await executarCrudCadastro(event, config);
  } catch (erro) {
    console.error('Erro não tratado no CRUD de cadastro:', erro);
    return json(500, {
      erro: 'Erro interno no servidor. Se isso persistir, confira as variáveis de ambiente SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_KEY na Netlify.',
      detalhe: erro?.message,
    });
  }
}

async function executarCrudCadastro(event, config) {
  const { table, campo, campoLabel, extras = [], mensagensDuplicidade } = config;
  const supabase = getSupabaseAdmin();

  // Leitura: qualquer usuário autenticado (motorista precisa ver as opções
  // pra montar o formulário de viagem).
  if (event.httpMethod === 'GET') {
    const auth = await requireAuth(event);
    if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

    const somenteAtivos = event.queryStringParameters?.todos !== '1';
    let query = supabase.from(table).select('*').order(campo, { ascending: true });
    if (somenteAtivos) query = query.eq('ativo', true);

    const { data, error } = await query;
    if (error) return json(500, { erro: 'Erro ao buscar cadastro.', detalhe: error.message });
    return json(200, { itens: data });
  }

  // Escrita: só admin (gerenciaOnly).
  const auth = await requireAuth(event, { gerenciaOnly: true });
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  if (event.httpMethod === 'POST') {
    const body = safeJsonParse(event.body);
    if (!body || !body[campo] || !String(body[campo]).trim()) {
      return json(400, { erro: `Informe ${campoLabel}.` });
    }
    const payload = { [campo]: String(body[campo]).trim() };
    for (const extra of extras) {
      if (body[extra] !== undefined) payload[extra] = body[extra];
    }
    const { data, error } = await supabase.from(table).insert(payload).select().single();
    if (error) {
      if (error.code === '23505') return json(409, { erro: mensagemDeDuplicidade(error, campoLabel, mensagensDuplicidade) });
      return json(500, { erro: 'Erro ao cadastrar.', detalhe: error.message });
    }
    return json(201, { item: data });
  }

  if (event.httpMethod === 'PUT') {
    const body = safeJsonParse(event.body);
    const id = body?.id || event.queryStringParameters?.id;
    if (!id) return json(400, { erro: 'Informe o id do registro.' });

    const payload = {};
    if (body[campo] !== undefined) payload[campo] = String(body[campo]).trim();
    if (body.ativo !== undefined) payload.ativo = !!body.ativo;
    for (const extra of extras) {
      if (body[extra] !== undefined) payload[extra] = body[extra];
    }

    const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().single();
    if (error) {
      if (error.code === '23505') return json(409, { erro: mensagemDeDuplicidade(error, campoLabel, mensagensDuplicidade) });
      return json(500, { erro: 'Erro ao atualizar.', detalhe: error.message });
    }
    return json(200, { item: data });
  }

  if (event.httpMethod === 'DELETE') {
    // Nunca apaga de verdade (histórico de viagens referencia estes ids) —
    // "excluir" aqui é desativar, pra sumir da lista de seleção sem quebrar
    // viagens antigas.
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { erro: 'Informe o id do registro.' });

    const { error } = await supabase.from(table).update({ ativo: false }).eq('id', id);
    if (error) return json(500, { erro: 'Erro ao desativar.', detalhe: error.message });
    return json(200, { ok: true });
  }

  return json(405, { erro: 'Método não permitido.' });
}

module.exports = { handleCrudCadastro };
