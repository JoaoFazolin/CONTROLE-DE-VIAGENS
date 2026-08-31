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
    const nome = String(body.nome).trim();

    // Diferente de caminhão/escavadeira/local/destino, profiles.nome NÃO é
    // unique no banco (dois motoristas de verdade podem ter o mesmo nome) —
    // então recriar um motorista com o mesmo nome de um que foi desativado
    // não dava erro nenhum, mas criava uma pessoa "nova" sem nenhum vínculo
    // com o histórico de viagens da antiga. Se existe exatamente UM
    // motorista inativo com esse nome (comparando sem diferenciar maiúsculas/
    // minúsculas nem espaços nas pontas — comparação exata no banco deixava
    // passar batido o caso mais comum de digitar "joão silva" na segunda vez
    // em vez de "João Silva", caindo direto no bug que essa checagem devia
    // evitar), reativa ele em vez de criar um segundo registro (se houver
    // mais de um, a escolha seria ambígua — melhor cadastrar como novo mesmo
    // do que reativar o motorista errado).
    const { data: inativos, error: erroBusca } = await supabase
      .from('profiles')
      .select('id, nome')
      .eq('role', 'motorista')
      .eq('ativo', false);
    if (erroBusca) return json(500, { erro: 'Erro ao cadastrar motorista.', detalhe: erroBusca.message });

    const normalizar = (texto) => String(texto || '').trim().toLowerCase();
    const candidatosInativos = (inativos || []).filter((p) => normalizar(p.nome) === normalizar(nome));

    if (candidatosInativos && candidatosInativos.length === 1) {
      const { data, error } = await supabase
        .from('profiles')
        .update({ nome, ativo: true })
        .eq('id', candidatosInativos[0].id)
        .select()
        .single();
      if (error) return json(500, { erro: 'Erro ao reativar motorista.', detalhe: error.message });
      return json(201, { item: data });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({ nome, role: 'motorista', ativo: true })
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
    if (body.nome !== undefined) {
      // Mesma exigência do POST (linha ~42): sem isso, um PUT com nome em
      // branco (ou só espaços) gravava string vazia sem erro nenhum.
      const nome = String(body.nome).trim();
      if (!nome) return json(400, { erro: 'Informe o nome do motorista.' });
      payload.nome = nome;
    }
    if (body.ativo !== undefined) payload.ativo = !!body.ativo;

    // .maybeSingle() (não .single()) — quando o id não existe ou não é um
    // motorista, o .eq('role','motorista') faz o update casar 0 linhas.
    // Com .single(), o PostgREST responde com ERRO nesse caso (não
    // `data: null` sem erro), e esse erro caía direto no 500 genérico logo
    // abaixo — nunca no 404 amigável que já existia (mas nunca era
    // alcançado). Ex: PUT em /api/motoristas com o id de um admin/operador
    // avançado devolvia "Erro ao atualizar" em vez da mensagem clara.
    const { data, error } = await supabase.from('profiles').update(payload).eq('id', id).eq('role', 'motorista').select().maybeSingle();
    if (error) return json(500, { erro: 'Erro ao atualizar.', detalhe: error.message });
    if (!data) return json(404, { erro: 'Motorista não encontrado (ou não é um motorista — edite Operador/Admin em Usuários).' });
    return json(200, { item: data });
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { erro: 'Informe o id do motorista.' });

    // .select().maybeSingle() (em vez de update() sem retorno nenhum) —
    // sem isso, um update que casa 0 linhas (id inexistente, ou é um
    // admin/operador avançado, não um motorista) NÃO gera erro nenhum: a
    // function respondia 200 { ok: true } como se tivesse desativado
    // alguém, mesmo sem ter mudado nada — um admin podia achar que revogou
    // o acesso de alguém e a pessoa continuava ativa.
    const { data, error } = await supabase.from('profiles').update({ ativo: false }).eq('id', id).eq('role', 'motorista').select().maybeSingle();
    if (error) return json(500, { erro: 'Erro ao desativar.', detalhe: error.message });
    if (!data) return json(404, { erro: 'Motorista não encontrado (ou não é um motorista — edite Operador/Admin em Usuários).' });

    // Mesma correção aplicada em caminhões: sem isso, o vínculo motorista→
    // caminhão ficava preso apontando pra um motorista escondido/inativo, e
    // como caminhoes.motorista_id é unique, esse caminhão nunca mais podia
    // ser vinculado a outro motorista sem mexer direto no banco.
    await supabase.from('caminhoes').update({ motorista_id: null }).eq('motorista_id', id);

    return json(200, { ok: true });
  }

  return json(405, { erro: 'Método não permitido.' });
});
