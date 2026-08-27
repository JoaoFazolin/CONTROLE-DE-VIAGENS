#!/usr/bin/env node
// Teste de diagnóstico rápido — roda depois de qualquer deploy pra
// confirmar que o backend está respondendo certo, sem precisar abrir o
// app e testar tela por tela. Mesmo espírito do test-api.js do sistema de
// combustível, só que via Node (precisa do Node 18+, que já tem fetch
// embutido) em vez de colar no console do navegador.
//
// Uso:
//   SITE_URL=https://viagemlr.netlify.app EMAIL=voce@exemplo.com SENHA=suasenha node test-api.js
//
// Ou, se preferir, edite os valores padrão abaixo antes de rodar.

const SITE_URL = process.env.SITE_URL || 'http://localhost:8888';
const EMAIL = process.env.EMAIL || '';
const SENHA = process.env.SENHA || '';

let falhas = 0;

function ok(msg) {
  console.log(`✅ ${msg}`);
}
function falha(msg) {
  console.log(`❌ ${msg}`);
  falhas++;
}
function info(msg) {
  console.log(`\n${msg}`);
}

async function main() {
  console.log('🔍 TESTE DE DIAGNÓSTICO — LR Controle de Viagens');
  console.log('='.repeat(60));
  console.log(`Site: ${SITE_URL}`);

  if (!EMAIL || !SENHA) {
    falha('Defina EMAIL e SENHA (variáveis de ambiente) antes de rodar. Ex:\n   SITE_URL=https://seu-site.netlify.app EMAIL=... SENHA=... node test-api.js');
    process.exit(1);
  }

  // 1. Login
  info('1️⃣  Login — POST /api/auth-login');
  const respLogin = await fetch(`${SITE_URL}/api/auth-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, senha: SENHA }),
  });
  const corpoLogin = await respLogin.json().catch(() => null);
  console.log('Status:', respLogin.status);

  if (!respLogin.ok || !corpoLogin?.access_token) {
    falha(`Login falhou: ${corpoLogin?.erro || 'resposta inesperada (veja se o site está no ar e as env vars da Netlify estão certas)'}`);
    resumoFinal();
    return;
  }
  ok(`Login OK — ${corpoLogin.usuario.nome} (${corpoLogin.usuario.role})`);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${corpoLogin.access_token}`,
  };

  // 2. Renovação de sessão
  info('2️⃣  Renovação de sessão — POST /api/auth-refresh');
  const respRefresh = await fetch(`${SITE_URL}/api/auth-refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: corpoLogin.refresh_token }),
  });
  const corpoRefresh = await respRefresh.json().catch(() => null);
  if (respRefresh.ok && corpoRefresh?.access_token) {
    ok('Renovação de sessão OK');
  } else {
    falha(`Renovação de sessão falhou: ${corpoRefresh?.erro || respRefresh.status}`);
  }

  // 3. Cadastros (listas)
  const cadastros = [
    ['/api/caminhoes', 'Caminhões'],
    ['/api/escavadeiras', 'Escavadeiras'],
    ['/api/locais-carga', 'Locais de carga'],
    ['/api/destinos', 'Destinos'],
    ['/api/motoristas', 'Motoristas'],
  ];
  info('3️⃣  Cadastros');
  for (const [caminho, nome] of cadastros) {
    const resp = await fetch(`${SITE_URL}${caminho}`, { headers });
    const corpo = await resp.json().catch(() => null);
    if (resp.ok && Array.isArray(corpo?.itens)) {
      ok(`${nome}: ${corpo.itens.length} cadastrado(s)`);
    } else {
      falha(`${nome} falhou (status ${resp.status}): ${corpo?.erro || 'resposta inesperada'}`);
    }
  }

  // 4. Resumo do dia + dashboard
  const hoje = new Date().toISOString().slice(0, 10);
  const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  info('4️⃣  Resumo do dia — GET /api/resumo-dia');
  const respResumo = await fetch(`${SITE_URL}/api/resumo-dia?data=${hoje}`, { headers });
  const corpoResumo = await respResumo.json().catch(() => null);
  if (respResumo.ok && corpoResumo) {
    ok(`Resumo de hoje: ${corpoResumo.total_viagens} viagens, ${corpoResumo.motoristas_distintos} motorista(s)`);
  } else {
    falha(`Resumo do dia falhou (status ${respResumo.status}): ${corpoResumo?.erro || 'resposta inesperada'}`);
  }

  if (corpoLogin.usuario.role === 'admin' || corpoLogin.usuario.role === 'operador_avancado') {
    info('5️⃣  Dashboard — GET /api/dashboard');
    const respDash = await fetch(`${SITE_URL}/api/dashboard?inicio=${trintaDiasAtras}&fim=${hoje}`, { headers });
    const corpoDash = await respDash.json().catch(() => null);
    if (respDash.ok && corpoDash) {
      ok(`Dashboard OK — ${corpoDash.total_viagens} viagens nos últimos 30 dias`);
    } else {
      falha(`Dashboard falhou (status ${respDash.status}): ${corpoDash?.erro || 'resposta inesperada'}`);
    }
  } else {
    console.log('\n(pulando teste de Dashboard — usuário logado é motorista comum, sem acesso)');
  }

  resumoFinal();
}

function resumoFinal() {
  console.log('\n' + '='.repeat(60));
  if (falhas === 0) {
    console.log('📋 RESUMO: tudo certo — nenhuma falha encontrada.');
  } else {
    console.log(`📋 RESUMO: ${falhas} falha(s) encontrada(s). Veja os ❌ acima.`);
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error('❌ Erro inesperado ao rodar o teste:', erro.message);
  process.exitCode = 1;
});
