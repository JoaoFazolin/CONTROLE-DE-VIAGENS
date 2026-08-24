const { getSupabaseAnon } = require('../lib/supabaseAdmin');
const { json, noContentPreflight, safeJsonParse, comTratamentoDeErro } = require('../lib/http');

// POST /api/auth-refresh  { refresh_token }
// Troca o refresh_token por um novo par access_token/refresh_token
// (rotação automática). O frontend chama isso periodicamente em segundo
// plano para a sessão nunca expirar sozinha, mesmo com o app fechado por
// dias em campo.
exports.handler = comTratamentoDeErro(async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  if (event.httpMethod !== 'POST') {
    return json(405, { erro: 'Método não permitido.' });
  }

  const body = safeJsonParse(event.body);
  if (!body) return json(400, { erro: 'JSON inválido.' });

  const { refresh_token } = body;
  if (!refresh_token) {
    return json(400, { erro: 'refresh_token ausente.' });
  }

  const anon = getSupabaseAnon();
  const { data, error } = await anon.auth.refreshSession({ refresh_token });

  if (error || !data?.session) {
    return json(401, { erro: 'Sessão não pôde ser renovada. Faça login novamente.' });
  }

  return json(200, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
});
