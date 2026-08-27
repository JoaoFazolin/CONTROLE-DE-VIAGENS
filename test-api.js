// Teste de diagnóstico — rode isso no console do navegador (F12)
// Copie TUDO abaixo, cole no console do navegador e pressione Enter

(async function() {
  console.log('🔍 TESTE DE DIAGNÓSTICO');
  console.log('='.repeat(50));

  try {
    const session = JSON.parse(localStorage.getItem('session_v1'));
    if (!session) {
      console.error('❌ Nenhuma sessão encontrada. Faça login primeiro.');
      return;
    }
    console.log('✅ Sessão encontrada:', session.nome, '(' + session.role + ')');
    console.log('Token:', session.access_token.substring(0, 20) + '...');

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token
    };

    // Teste 1: Carregar equipamentos
    console.log('\n1️⃣ Testando: /api/equipamentos');
    const eqRes = await fetch('/api/equipamentos', { headers });
    console.log('Status:', eqRes.status);
    const eqData = await eqRes.json();
    console.log('Resposta:', eqData);
    console.log('Total de equipamentos:', eqData.length);

    // Teste 2: Carregar obras
    console.log('\n2️⃣ Testando: /api/obras');
    const obRes = await fetch('/api/obras', { headers });
    console.log('Status:', obRes.status);
    const obData = await obRes.json();
    console.log('Resposta:', obData);
    console.log('Total de obras:', obData.length);

    // Teste 3: Carregar tipos de combustível
    console.log('\n3️⃣ Testando: /api/tipos-combustivel');
    const tcRes = await fetch('/api/tipos-combustivel', { headers });
    console.log('Status:', tcRes.status);
    const tcData = await tcRes.json();
    console.log('Resposta:', tcData);
    console.log('Total de combustíveis:', tcData.length);

    console.log('\n' + '='.repeat(50));
    console.log('📋 RESUMO:');
    console.log(`✅ Equipamentos: ${eqData.length > 0 ? eqData.length + ' encontrados' : '❌ NENHUM'}`);
    console.log(`✅ Obras: ${obData.length > 0 ? obData.length + ' encontradas' : '❌ NENHUMA'}`);
    console.log(`✅ Combustíveis: ${tcData.length > 0 ? tcData.length + ' encontrados' : '❌ NENHUM'}`);

  } catch (e) {
    console.error('❌ Erro:', e.message);
    console.error(e);
  }
})();
