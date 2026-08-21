// Verificação de sessão para as functions protegidas.
// O frontend manda o access_token do Supabase Auth no header Authorization:
// "Bearer <token>". Aqui validamos esse token com a service_role key e
// carregamos o perfil (nome/role) da tabela profiles.
const { getSupabaseAdmin } = require('./supabaseAdmin');

/**
 * @param {object} event  evento da Netlify Function
 * @param {{ adminOnly?: boolean }} [options]
 * @returns {Promise<{ ok: true, user: { id: string, nome: string, role: string } } | { ok: false, statusCode: number, message: string }>}
 */
async function requireAuth(event, options = {}) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, statusCode: 401, message: 'Sessão ausente. Faça login novamente.' };
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, statusCode: 401, message: 'Sessão ausente. Faça login novamente.' };
  }

  const supabase = getSupabaseAdmin();

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, statusCode: 401, message: 'Sessão expirada ou inválida. Faça login novamente.' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, nome, role, ativo')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile) {
    return { ok: false, statusCode: 403, message: 'Usuário sem perfil cadastrado no sistema.' };
  }
  if (!profile.ativo) {
    return { ok: false, statusCode: 403, message: 'Usuário desativado. Fale com o administrador.' };
  }
  if (options.adminOnly && profile.role !== 'admin') {
    return { ok: false, statusCode: 403, message: 'Ação permitida apenas para administradores.' };
  }

  return { ok: true, user: { id: profile.id, nome: profile.nome, role: profile.role } };
}

module.exports = { requireAuth };
