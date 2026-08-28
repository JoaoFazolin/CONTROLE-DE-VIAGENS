// Guarda o instante da última chamada bem-sucedida ao servidor, pra mostrar
// no cabeçalho "há quanto tempo sincronizou pela última vez". Complementa o
// contador de pendentes (que só diz QUANTO falta, não HÁ QUANTO TEMPO o app
// realmente conseguiu falar com o servidor).
const CHAVE_ARMAZENAMENTO = 'lrcv_ultima_sincronizacao';

// Quem quiser saber assim que uma sincronização acontece (ex: o cabeçalho,
// pra atualizar o texto na hora em vez de esperar o intervalo de 30s) pode
// se inscrever aqui.
const ouvintes = [];
export function aoSincronizar(callback) {
  ouvintes.push(callback);
}

export function registrarSincronizacaoOk() {
  try {
    localStorage.setItem(CHAVE_ARMAZENAMENTO, String(Date.now()));
  } catch {
    // localStorage indisponível (modo privado etc.) — não é crítico, só
    // deixa de mostrar o indicador.
  }
  ouvintes.forEach((cb) => {
    try { cb(); } catch { /* um ouvinte com erro não pode derrubar os outros */ }
  });
}

export function obterUltimaSincronizacao() {
  try {
    const bruto = localStorage.getItem(CHAVE_ARMAZENAMENTO);
    return bruto ? Number(bruto) : null;
  } catch {
    return null;
  }
}

export function formatarTempoDecorrido(timestampMs) {
  if (!timestampMs) return 'nunca';
  const segundos = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (segundos < 10) return 'agora mesmo';
  if (segundos < 60) return `há ${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias}d`;
}
