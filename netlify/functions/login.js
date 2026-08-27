const { getAnonClient } = require('./lib/authGuard');
const { getSupabase } = require('./lib/supabase');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* ignore */ }

  const email = (body.email || '').trim();
  const password = body.password || '';
  if (!email || !password) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Informe e-mail e senha.' }) };
  }

  try {
    const anon = getAnonClient();
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'E-mail ou senha inválidos.' }) };
    }

    const supabase = getSupabase();
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Usuário autenticado mas sem perfil cadastrado. Peça para o administrador liberar seu acesso.' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        id: profile.id,
        nome: profile.nome,
        role: profile.role
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
