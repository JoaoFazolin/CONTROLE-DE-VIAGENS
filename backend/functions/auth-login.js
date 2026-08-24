const { getSupabaseAdmin, getSupabaseAnon } = require('../lib/supabaseAdmin');
const { json, noContentPreflight, safeJsonParse, comTratamentoDeErro } = require('../lib/http');

// POST /api/auth-login  { email, senha }
// Faz login via Supabase Auth usando a anon key (o frontend nunca tem
// contato com nenhuma chave do Supabase — só fala com esta function).
// Devolve access_token + refresh_token para o frontend guardar e usar nas
// próximas chamadas.
exports.handler = comTratamentoDeErro(async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  if (event.httpMethod !== 'POST') {
    return json(405, { erro: 'Método não permitido.' });
  }

  const body = safeJsonParse(event.body);
  if (!body) return json(400, { erro: 'JSON inválido.' });

  const { email, senha } = body;
  if (!email || !senha) {
    return json(400, { erro: 'Informe e-mail e senha.' });
  }

  // Login em si acontece com a anon key (mesmo padrão do sistema de
  // combustível) — a service key só entra depois, pra buscar o perfil.
  const anon = getSupabaseAnon();

  const { data, error } = await anon.auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password: senha,
  });

  if (error || !data?.session) {
    return json(401, { erro: 'E-mail ou senha inválidos.' });
  }

  const supabase = getSupabaseAdmin();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, nome, role, ativo')
    .eq('id', data.user.id)
    .single();

  if (profileError) {
    console.error('Erro ao buscar perfil no login:', profileError);
    return json(500, {
      erro: 'Login autenticou, mas não foi possível buscar o perfil. Confira a variável SUPABASE_SERVICE_KEY na Netlify.',
      detalhe: profileError.message,
    });
  }

  if (!profile || !profile.ativo) {
    return json(403, { erro: 'Usuário sem acesso liberado. Fale com o administrador.' });
  }

  return json(200, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    usuario: { id: profile.id, nome: profile.nome, role: profile.role },
  });
});
