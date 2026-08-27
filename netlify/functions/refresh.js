const { getAnonClient } = require('./lib/authGuard');

// Troca um refresh_token por um novo par access_token/refresh_token.
// Chamado automaticamente pelo app (nunca precisa ser digitado pelo usuário)
// para manter a sessão viva por muito tempo sem pedir login de novo.
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* ignore */ }
  const refresh_token = body.refresh_token;
  if (!refresh_token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'refresh_token é obrigatório.' }) };
  }

  try {
    const anon = getAnonClient();
    const { data, error } = await anon.auth.refreshSession({ refresh_token });
    if (error || !data.session) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sessão expirada. Faça login novamente.' }) };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
