import { exigirLogin, obterSessao } from './auth.js';
import { montarCabecalho } from '../layout/cabecalho.js';
import { chamarApi, ErroApi } from './api.js';

if (!exigirLogin()) throw new Error('redirecionando para login');

const sessao = obterSessao();
const ehGerente = sessao.usuario.role === 'admin' || sessao.usuario.role === 'operador_avancado';
if (!ehGerente) {
  window.location.href = 'app.html';
}

montarCabecalho('relatorios');

const campoInicio = document.getElementById('campo-inicio');
const campoFim = document.getElementById('campo-fim');
const avisoErro = document.getElementById('aviso-erro');
const btnExportar = document.getElementById('btn-exportar');

const hoje = new Date();
const primeiroDiaDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
campoInicio.value = primeiroDiaDoMes.toISOString().slice(0, 10);
campoFim.value = hoje.toISOString().slice(0, 10);

btnExportar.addEventListener('click', async () => {
  avisoErro.style.display = 'none';

  if (!campoInicio.value || !campoFim.value) {
    avisoErro.textContent = 'Selecione o período.';
    avisoErro.style.display = 'block';
    return;
  }

  btnExportar.disabled = true;
  btnExportar.textContent = 'Gerando…';

  try {
    const resposta = await chamarApi(`/api/relatorio-excel?inicio=${campoInicio.value}&fim=${campoFim.value}`);
    const blob = await resposta.blob();

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `viagens_${campoInicio.value}_a_${campoFim.value}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (erro) {
    avisoErro.textContent = erro instanceof ErroApi ? erro.message : 'Erro ao gerar o relatório. Confira sua conexão.';
    avisoErro.style.display = 'block';
  } finally {
    btnExportar.disabled = false;
    btnExportar.textContent = 'Baixar planilha (.xlsx)';
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
