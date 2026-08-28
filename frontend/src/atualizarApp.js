// Força o app a pegar a versão mais nova de verdade: desregistra o service
// worker e apaga todo o cache dele, depois recarrega a página. Sem isso, o
// PWA pode continuar mostrando uma versão antiga (o service worker serve o
// "shell" do app em cache-first, então um deploy novo às vezes só aparece
// de verdade depois de duas aberturas do app — esse botão evita ter que
// esperar isso).
export async function atualizarAppCompleto() {
  try {
    if ('serviceWorker' in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((chave) => caches.delete(chave)));
    }
  } catch (erro) {
    console.warn('Erro ao limpar o cache do app:', erro);
  } finally {
    window.location.reload();
  }
}
