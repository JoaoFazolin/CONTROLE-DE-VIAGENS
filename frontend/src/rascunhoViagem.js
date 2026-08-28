// Rascunho da "Nova viagem": guarda no aparelho (localStorage) o que já foi
// preenchido no formulário, mesmo antes de salvar — pra não perder nada se
// o app for minimizado, a aba fechada, ou o aparelho trocar de tela no
// meio do preenchimento (comum em obra). Não é a fila de pendentes (aquilo
// é pra viagem já CONFIRMADA sem internet); isso aqui é só o rascunho do
// formulário em aberto.
const CHAVE = 'lrcv_rascunho_viagem';

export function salvarRascunho(dados) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ ...dados, salvo_em: Date.now() }));
  } catch {
    // localStorage indisponível (modo privado etc.) — sem rascunho, mas não
    // é motivo pra travar o formulário.
  }
}

export function obterRascunho() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

export function limparRascunho() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // ignore
  }
}

// Só vale a pena mostrar/guardar o rascunho se tiver algo além do padrão
// (senão toda tela vazia "restauraria" um aviso à toa).
export function rascunhoTemConteudo(dados) {
  if (!dados) return false;
  return Boolean(
    dados.caminhao_id ||
      dados.escavadeira_id ||
      dados.local_carga_id ||
      dados.destino_id ||
      dados.motorista_id ||
      (dados.total_viagens && String(dados.total_viagens) !== '1')
  );
}
