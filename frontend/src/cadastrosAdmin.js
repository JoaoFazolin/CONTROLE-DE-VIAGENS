import { exigirLogin, obterSessao } from './auth.js';
import { montarCabecalho } from '../layout/cabecalho.js';
import { chamarApi, ErroApi } from './api.js';

if (!exigirLogin()) throw new Error('redirecionando para login');

const sessao = obterSessao();
if (sessao.usuario.role !== 'admin') {
  window.location.href = 'app.html';
}

montarCabecalho('cadastros');

const avisoErro = document.getElementById('aviso-erro');
function mostrarErro(erro) {
  avisoErro.textContent = erro instanceof ErroApi ? erro.message : 'Erro inesperado.';
  avisoErro.style.display = 'block';
  setTimeout(() => (avisoErro.style.display = 'none'), 5000);
}

// --- Recursos simples (caminhões, escavadeiras, locais) -------------------
const RECURSOS_SIMPLES = [
  { recurso: 'caminhoes', caminho: '/api/caminhoes', campo: 'codigo', listaId: 'lista-caminhoes' },
  { recurso: 'escavadeiras', caminho: '/api/escavadeiras', campo: 'codigo', listaId: 'lista-escavadeiras' },
  { recurso: 'locais-carga', caminho: '/api/locais-carga', campo: 'nome', listaId: 'lista-locais-carga' },
];

function linhaComExcluir(id, texto, aoExcluir) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${texto}</td><td style="text-align:right;"><button type="button" class="btn btn-pequeno btn-perigo">Desativar</button></td>`;
  tr.querySelector('button').addEventListener('click', async () => {
    if (!confirm(`Desativar "${texto}"? Ele some das opções de lançamento, mas o histórico é mantido.`)) return;
    try {
      await aoExcluir(id);
    } catch (erro) {
      mostrarErro(erro);
    }
  });
  return tr;
}

async function carregarSimples({ caminho, campo, listaId }) {
  try {
    const resultado = await chamarApi(caminho);
    const corpo = document.getElementById(listaId);
    corpo.innerHTML = '';
    for (const item of resultado.itens) {
      corpo.appendChild(
        linhaComExcluir(item.id, item[campo], async (id) => {
          await chamarApi(`${caminho}?id=${id}`, { metodo: 'DELETE' });
          carregarSimples({ caminho, campo, listaId });
        })
      );
    }
  } catch (erro) {
    mostrarErro(erro);
  }
}

document.querySelectorAll('.form-cadastro').forEach((form) => {
  const recurso = form.dataset.recurso;
  const campo = form.dataset.campo;
  const caminho = `/api/${recurso}`;
  const listaId = `lista-${recurso}`;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valor = form.querySelector('[name="valor"]').value.trim();
    if (!valor) return;
    try {
      await chamarApi(caminho, { metodo: 'POST', corpo: { [campo]: valor } });
      form.reset();
      carregarSimples({ caminho, campo, listaId });
    } catch (erro) {
      mostrarErro(erro);
    }
  });

  carregarSimples({ caminho, campo, listaId });
});

// --- Destinos (código + descrição) -----------------------------------------
async function carregarDestinos() {
  try {
    const resultado = await chamarApi('/api/destinos');
    const corpo = document.getElementById('lista-destinos');
    corpo.innerHTML = '';
    for (const item of resultado.itens) {
      corpo.appendChild(
        linhaComExcluir(item.id, `${item.codigo}${item.descricao ? ' — ' + item.descricao : ''}`, async (id) => {
          await chamarApi(`/api/destinos?id=${id}`, { metodo: 'DELETE' });
          carregarDestinos();
        })
      );
    }
  } catch (erro) {
    mostrarErro(erro);
  }
}

document.getElementById('form-destino').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const codigo = form.codigo.value.trim();
  const descricao = form.descricao.value.trim();
  if (!codigo) return;
  try {
    await chamarApi('/api/destinos', { metodo: 'POST', corpo: { codigo, descricao } });
    form.reset();
    carregarDestinos();
  } catch (erro) {
    mostrarErro(erro);
  }
});
carregarDestinos();

// --- Motoristas --------------------------------------------------------
async function carregarMotoristas() {
  try {
    const resultado = await chamarApi('/api/motoristas');
    const corpo = document.getElementById('lista-motoristas');
    corpo.innerHTML = '';
    for (const item of resultado.itens) {
      const texto = `${item.nome} (${item.role === 'admin' ? 'Administrador' : 'Motorista'})`;
      corpo.appendChild(
        linhaComExcluir(item.id, texto, async (id) => {
          await chamarApi(`/api/motoristas?id=${id}`, { metodo: 'DELETE' });
          carregarMotoristas();
        })
      );
    }
  } catch (erro) {
    mostrarErro(erro);
  }
}

document.getElementById('form-motorista').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const nome = form.nome.value.trim();
  const email = form.email.value.trim();
  const senha = form.senha.value;
  const role = form.role.value;
  if (!nome || !email || !senha) return;
  try {
    await chamarApi('/api/motoristas', { metodo: 'POST', corpo: { nome, email, senha, role } });
    form.reset();
    carregarMotoristas();
  } catch (erro) {
    mostrarErro(erro);
  }
});
carregarMotoristas();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
