import { entrar, estaLogado } from './auth.js';

if (estaLogado()) {
  window.location.href = 'app.html';
}

const form = document.getElementById('form-login');
const avisoErro = document.getElementById('aviso-erro');
const btnEntrar = document.getElementById('btn-entrar');

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  avisoErro.style.display = 'none';
  btnEntrar.disabled = true;
  btnEntrar.textContent = 'Entrando…';

  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value;

  try {
    await entrar(email, senha);
    window.location.href = 'app.html';
  } catch (erro) {
    avisoErro.textContent = erro.message || 'Sem conexão. Tente novamente quando tiver internet (o primeiro login precisa de rede).';
    avisoErro.style.display = 'block';
  } finally {
    btnEntrar.disabled = false;
    btnEntrar.textContent = 'Entrar';
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
