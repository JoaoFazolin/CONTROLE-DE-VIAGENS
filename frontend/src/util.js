// Funções pequenas e genéricas, usadas por mais de uma tela.

// Escapa texto antes de colocar dentro de innerHTML/insertAdjacentHTML.
// Necessário sempre que o texto vem de um cadastro (código de caminhão,
// nome de motorista, descrição de destino etc) — são campos livres,
// digitados por um admin, sem nenhuma restrição de caractere. Sem escapar,
// um código/nome contendo HTML (ex: "<img src=x onerror=...>") executaria
// na tela de qualquer outro admin/operador que visse esse mesmo dado
// (histórico de viagens, dashboard) — um "stored XSS" clássico.
export function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
