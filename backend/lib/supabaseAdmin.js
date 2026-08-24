// Dois clientes Supabase, mesmo padrão do sistema de combustível já
// validado (CONTROLE_OBRA):
//
// - getSupabaseAdmin(): usa a SUPABASE_SERVICE_KEY (service_role). Ignora
//   RLS — é o único jeito de ler/gravar nas tabelas. Só roda aqui no
//   backend (Netlify Functions); nunca importe este arquivo em código de
//   frontend.
// - getSupabaseAnon(): usa a SUPABASE_ANON_KEY. Serve só pra chamar o
//   Supabase Auth (signInWithPassword, refreshSession, getUser) — a anon
//   key sozinha não dá acesso a nenhum dado, porque RLS bloqueia tudo sem
//   a service key.
const { createClient } = require('@supabase/supabase-js');

let clienteAdmin = null;
let clienteAnon = null;

function getSupabaseAdmin() {
  if (clienteAdmin) return clienteAdmin;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_KEY precisam estar configuradas ' +
        'nas variáveis de ambiente da Netlify (nunca commitadas no repo).'
    );
  }

  clienteAdmin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return clienteAdmin;
}

function getSupabaseAnon() {
  if (clienteAnon) return clienteAnon;

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_ANON_KEY precisam estar configuradas ' +
        'nas variáveis de ambiente da Netlify (nunca commitadas no repo).'
    );
  }

  clienteAnon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return clienteAnon;
}

module.exports = { getSupabaseAdmin, getSupabaseAnon };
