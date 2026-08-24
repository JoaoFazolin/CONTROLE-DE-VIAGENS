// Helpers pequenos e repetidos por toda function.

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function noContentPreflight() {
  return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
    body: '',
  };
}

function safeJsonParse(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// Envolve o handler de cada function: se algo não previsto lançar uma
// exceção (ex: variável de ambiente ausente, erro de rede com o Supabase),
// devolve um JSON de erro 500 legível em vez de deixar a Netlify estourar
// um 502 opaco sem corpo nenhum. Isso foi um problema real: variáveis de
// ambiente ausentes faziam a function travar sem mensagem.
function comTratamentoDeErro(handler) {
  return async function (event, context) {
    try {
      return await handler(event, context);
    } catch (erro) {
      console.error('Erro não tratado na function:', erro);
      return json(500, {
        erro: 'Erro interno no servidor. Se isso persistir, confira as variáveis de ambiente SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_KEY na Netlify.',
        detalhe: erro?.message,
      });
    }
  };
}

module.exports = { json, noContentPreflight, safeJsonParse, comTratamentoDeErro };
