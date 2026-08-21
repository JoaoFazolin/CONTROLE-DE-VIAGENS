const { requireAuth } = require('../lib/auth');
const { json, noContentPreflight } = require('../lib/http');

// GET /api/me — devolve o perfil do usuário logado (nome, papel).
// Usado no boot do app pra decidir se mostra as telas de admin ou não.
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  if (event.httpMethod !== 'GET') return json(405, { erro: 'Método não permitido.' });

  const auth = await requireAuth(event);
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  return json(200, { usuario: auth.user });
};
