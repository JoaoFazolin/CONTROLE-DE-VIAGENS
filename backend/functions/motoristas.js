const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight, safeJsonParse, comTratamentoDeErro } = require('../lib/http');

// /api/motoristas
// GET: qualquer usuário autenticado (precisa da lista pra montar o formulário
//      de viagem, e admin lançando "por" um motorista específico). Devolve
//      todo mundo em profiles (motoristas, operadores, admins), igual antes.
// POST/PUT/DELETE: só admin — gerencia SÓ motoristas (nome, sem login). O
//      motorista nunca abre o app (ver README), então não faz sentido pedir
//      e-mail/senha pra ele — é só um registro de nome, pra poder ser
//      vinculado a um caminhão e escolhido como quem dirigiu uma carga.
//      migration_004 tirou a obrigatoriedade de profiles.id apontar pra um
//      login em auth.users, então o banco gera o id sozinho aqui.
//      Criar Operador Avançado/Admin (que precisam de login de verdade)
//      agora é em /api/usuarios — tela separada em Cadastros.
exports.handler = comTratamentoDeErro(async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  const supabase = getSupabaseAdmin();

  if (event.httpMethod === 'GET') {
    const auth = await requireAuth(event);
    if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

    const somenteAtivos = event.queryStringParameters?.todos !== '1';
    let query = supabase
      .from('profiles')
      .select('id, nome, role, ativo, criado_em')
      .order('nome', { ascending: true });
    if (somenteAtivos) query = query.eq('ativo', true);

    const { data, error } = await query;
    if (error) return json(500, { erro: 'Erro ao buscar motoristas.', detalhe: error.message });
    return json(200, { itens: data });
  }

  const auth = await requireAuth(event, { adminOnly: true });
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  if (event.httpMethod === 'POST') {
    const body = safeJsonParse(event.body);
    if (!body || !body.nome || !String(body.nome).trim()) {
      return json(400, { erro: 'Informe o nome do motorista.' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({ nome: String(body.nome).trim(), role: 'motorista', ativo: true })
      .select()
      .single();

    if (profileError) return json(500, { erro: 'Erro ao cadastrar motorista.', detalhe: profileError.message });
    return json(201, { item: profile });
  }

  if (event.httpMethod === 'PUT') {
    const body = safeJsonParse(event.body);
    const id = body?.id;
    if (!id) return json(400, { erro: 'Informe o id do motorista.' });

    // Só nome/ativo — não dá pra "promover" um motorista sem login a
    // Operador Avançado/Admin por aqui (ele não tem conta no Supabase Auth
    // pra logar); pra isso existe /api/usuarios.
    const payload = {};
    if (body.nome !== undefined) payload.nome = String(body.nome).trim();
    if (body.ativo !== undefined) payload.ativo = !!body.ativo;

    const { data, error } = await supabase.from('profiles').update(payload).eq('id', id).eq('role', 'motorista').select().single();
    if (error) return json(500, { erro: 'Erro ao atualizar.', detalhe: error.message });
    if (!data) return json(404, { erro: 'Motorista não encontrado (ou não é um motorista — edite Operador/Admin em Usuários).' });
    return json(200, { item: data });
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { erro: 'Informe o id do motorista.' });

    const { error } = await supabase.from('profiles').update({ ativo: false }).eq('id', id).eq('role', 'motorista');
    if (error) return json(500, { erro: 'Erro ao desativar.', detalhe: error.message });
    return json(200, { ok: true });
  }

  return json(405, { erro: 'Método não permitido.' });
});
