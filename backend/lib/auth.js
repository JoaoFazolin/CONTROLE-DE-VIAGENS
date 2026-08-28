// Verificação de sessão para as functions protegidas.
// O frontend manda o access_token do Supabase Auth no header Authorization:
// "Bearer <token>". Aqui validamos esse token com a service_role key e
// carregamos o perfil (nome/role) da tabela profiles.
const { getSupabaseAdmin, getSupabaseAnon } = require('./supabaseAdmin');

// "Gerencia" = só admin (decisão do cliente: Operador Avançado passou a
// só lançar a própria viagem, igual um motorista comum — sem acesso a
// Cadastros, Relatórios, Dashboard, nem a lançar/ver viagem de outra
// pessoa). Mantivemos o nome da função e o cargo "Operador Avançado" no
// sistema (pode voltar a ter mais acesso no futuro se o cliente pedir),
// só a regra de quem "pode gerenciar" que mudou pra admin-only.
function podeGerenciar(profile) {
  return !!profile && profile.role === 'admin';
}

/**
 * @param {object} event  evento da Netlify Function
 * @param {{ adminOnly?: boolean, gerenciaOnly?: boolean }} [options]
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

  // getUser() só valida o token (assinatura/expiração) — a anon key basta
  // pra isso, mesmo padrão do sistema de combustível.
  const anon = getSupabaseAnon();
  const { data: userData, error: userError } = await anon.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, statusCode: 401, message: 'Sessão expirada ou inválida. Faça login novamente.' };
  }

  const supabase = getSupabaseAdmin();
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
  if (options.gerenciaOnly && !podeGerenciar(profile)) {
    return { ok: false, statusCode: 403, message: 'Ação permitida apenas para administradores.' };
  }

  return { ok: true, user: { id: profile.id, nome: profile.nome, role: profile.role } };
}

module.exports = { requireAuth, podeGerenciar };
