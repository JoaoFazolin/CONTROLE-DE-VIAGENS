const { createClient } = require('@supabase/supabase-js');
const { getSupabase } = require('./supabase');

let anonClient = null;
function getAnonClient() {
  if (anonClient) return anonClient;
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL ou SUPABASE_ANON_KEY nao configurados nas variaveis de ambiente.');
  }
  anonClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return anonClient;
}

function extractToken(event) {
  const headers = event.headers || {};
  const raw = headers.authorization || headers.Authorization || '';
  return raw.replace(/^Bearer\s+/i, '').trim();
}

// Retorna { user, profile } se o token for valido, ou null.
async function requireAuth(event) {
  const token = extractToken(event);
  if (!token) return null;

  const anon = getAnonClient();
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data || !data.user) return null;

  const supabase = getSupabase();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) return null;

  return { user: data.user, profile };
}

function unauthorized(msg) {
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: msg || 'Sessão inválida. Faça login novamente.' })
  };
}

function forbidden(msg) {
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: msg || 'Você não tem permissão para esta ação.' })
  };
}

// "Gerencia" = admin OU operador_avancado. Usado em todo módulo que o
// Operador Avançado deve acessar por completo (equipamentos, obras,
// estoque, relatório, dashboard, editar/excluir lançamentos de qualquer
// operador). A tela de Usuários continua exclusiva do admin — não usa
// esta função, checa role === 'admin' diretamente.
function podeGerenciar(profile) {
  return !!profile && (profile.role === 'admin' || profile.role === 'operador_avancado');
}

module.exports = { requireAuth, unauthorized, forbidden, getAnonClient, podeGerenciar };
