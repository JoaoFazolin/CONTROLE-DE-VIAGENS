// Cliente Supabase usando a service_role key — SÓ roda aqui no backend
// (Netlify Functions). Nunca importe este arquivo em código de frontend.
// A service_role key ignora RLS, então esse é o único lugar autorizado
// a ler/gravar diretamente nas tabelas.
const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabaseAdmin() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configuradas ' +
        'nas variáveis de ambiente da Netlify (nunca commitadas no repo).'
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return client;
}

module.exports = { getSupabaseAdmin };
