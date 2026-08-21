const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { json, noContentPreflight, safeJsonParse } = require('../lib/http');

// POST /api/auth/login  { email, senha }
// Faz login via Supabase Auth usando a service_role key (o frontend nunca
// tem contato com nenhuma chave do Supabase). Devolve access_token +
// refresh_token para o frontend guardar e usar nas próximas chamadas.
exports.handler = async function (event) {
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

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password: senha,
  });

  if (error || !data?.session) {
    return json(401, { erro: 'E-mail ou senha inválidos.' });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, nome, role, ativo')
    .eq('id', data.user.id)
    .single();

  if (!profile || !profile.ativo) {
    return json(403, { erro: 'Usuário sem acesso liberado. Fale com o administrador.' });
  }

  return json(200, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    usuario: { id: profile.id, nome: profile.nome, role: profile.role },
  });
};
