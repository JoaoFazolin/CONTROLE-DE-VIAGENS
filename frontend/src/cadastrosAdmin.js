import { exigirLogin, obterSessao } from './auth.js';
import { montarCabecalho } from '../layout/cabecalho.js';
import { chamarApi, ErroApi } from './api.js';

if (!exigirLogin()) throw new Error('redirecionando para login');

const sessao = obterSessao();
const ehGerente = sessao.usuario.role === 'admin' || sessao.usuario.role === 'operador_avancado';
if (!ehGerente) {
  window.location.href = 'app.html';
}
// Tela de Motoristas continua exclusiva do admin — Operador Avançado
// gerencia os demais cadastros, mas não cria/edita login de ninguém.
if (sessao.usuario.role !== 'admin') {
  document.getElementById('secao-motoristas').style.display = 'none';
}

montarCabecalho('cadastros');

const avisoErro = document.getElementById('aviso-erro');
function mostrarErro(erro) {
  avisoErro.textContent = erro instanceof ErroApi ? erro.message : 'Erro inesperado.';
  avisoErro.style.display = 'block';
  setTimeout(() => (avisoErro.style.display = 'none'), 5000);
}

// --- Linha genérica com Editar (inline) + Desativar -------------------------
// `campos` descreve os inputs do modo de edição: [{ nome, valor, tipo }]
// `aoSalvar(id, valores)` recebe um objeto { nome: valorNovo, ... }
function linhaEditavel({ id, textoExibicao, campos, aoSalvar, aoDesativar }) {
  const tr = document.createElement('tr');
  const tdTexto = document.createElement('td');
  tdTexto.textContent = textoExibicao;
  const tdAcoes = document.createElement('td');
  tdAcoes.style.textAlign = 'right';
  tdAcoes.style.whiteSpace = 'nowrap';

  const btnEditar = document.createElement('button');
  btnEditar.type = 'button';
  btnEditar.className = 'btn btn-pequeno btn-secundario';
  btnEditar.textContent = 'Editar';
  btnEditar.style.marginRight = '6px';

  const btnDesativar = document.createElement('button');
  btnDesativar.type = 'button';
  btnDesativar.className = 'btn btn-pequeno btn-perigo';
  btnDesativar.textContent = 'Desativar';
  btnDesativar.addEventListener('click', async () => {
    if (!confirm(`Desativar "${textoExibicao}"? Ele some das opções de lançamento, mas o histórico é mantido.`)) return;
    try {
      await aoDesativar(id);
    } catch (erro) {
      mostrarErro(erro);
    }
  });

  tdAcoes.append(btnEditar, btnDesativar);
  tr.append(tdTexto, tdAcoes);

  btnEditar.addEventListener('click', () => {
    const trEdicao = document.createElement('tr');
    const tdForm = document.createElement('td');
    tdForm.colSpan = 2;

    const inputsPorNome = {};
    campos.forEach((c) => {
      const label = document.createElement('label');
      label.textContent = c.rotulo;
      label.style.marginTop = '8px';
      const input = c.tipo === 'select' ? document.createElement('select') : document.createElement('input');
      if (c.tipo !== 'select') input.type = c.tipo || 'text';
      if (c.tipo === 'select') {
        c.opcoes.forEach((op) => {
          const opt = document.createElement('option');
          opt.value = op.valor;
          opt.textContent = op.rotulo;
          if (op.valor === c.valor) opt.selected = true;
          input.appendChild(opt);
        });
      } else {
        input.value = c.valor || '';
      }
      inputsPorNome[c.nome] = input;
      tdForm.append(label, input);
    });

    const linhaBotoes = document.createElement('div');
    linhaBotoes.className = 'linha-botoes';
    linhaBotoes.style.marginTop = '10px';

    const btnSalvar = document.createElement('button');
    btnSalvar.type = 'button';
    btnSalvar.className = 'btn btn-primario';
    btnSalvar.textContent = 'Salvar';
    btnSalvar.addEventListener('click', async () => {
      const valores = {};
      for (const nome in inputsPorNome) valores[nome] = inputsPorNome[nome].value.trim();
      btnSalvar.disabled = true;
      try {
        await aoSalvar(id, valores);
        trEdicao.remove();
      } catch (erro) {
        mostrarErro(erro);
        btnSalvar.disabled = false;
      }
    });

    const btnCancelar = document.createElement('button');
    btnCancelar.type = 'button';
    btnCancelar.className = 'btn btn-secundario';
    btnCancelar.textContent = 'Cancelar';
    btnCancelar.addEventListener('click', () => trEdicao.remove());

    linhaBotoes.append(btnCancelar, btnSalvar);
    tdForm.appendChild(linhaBotoes);
    trEdicao.appendChild(tdForm);
    tr.after(trEdicao);
  });

  return tr;
}

// --- Recursos simples (caminhões, escavadeiras, locais) -------------------
async function carregarSimples({ caminho, campo, campoRotulo, listaId }) {
  try {
    const resultado = await chamarApi(caminho);
    const corpo = document.getElementById(listaId);
    corpo.innerHTML = '';
    for (const item of resultado.itens) {
      corpo.appendChild(
        linhaEditavel({
          id: item.id,
          textoExibicao: item[campo],
          campos: [{ nome: campo, rotulo: campoRotulo, valor: item[campo] }],
          aoSalvar: async (id, valores) => {
            await chamarApi(caminho, { metodo: 'PUT', corpo: { id, [campo]: valores[campo] } });
            carregarSimples({ caminho, campo, campoRotulo, listaId });
          },
          aoDesativar: async (id) => {
            await chamarApi(`${caminho}?id=${id}`, { metodo: 'DELETE' });
            carregarSimples({ caminho, campo, campoRotulo, listaId });
          },
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
  const campoRotulo = form.querySelector('label').textContent;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valor = form.querySelector('[name="valor"]').value.trim();
    if (!valor) return;
    try {
      await chamarApi(caminho, { metodo: 'POST', corpo: { [campo]: valor } });
      form.reset();
      carregarSimples({ caminho, campo, campoRotulo, listaId });
    } catch (erro) {
      mostrarErro(erro);
    }
  });

  carregarSimples({ caminho, campo, campoRotulo, listaId });
});

// --- Destinos (código + descrição) -----------------------------------------
async function carregarDestinos() {
  try {
    const resultado = await chamarApi('/api/destinos');
    const corpo = document.getElementById('lista-destinos');
    corpo.innerHTML = '';
    for (const item of resultado.itens) {
      corpo.appendChild(
        linhaEditavel({
          id: item.id,
          textoExibicao: `${item.codigo}${item.descricao ? ' — ' + item.descricao : ''}`,
          campos: [
            { nome: 'codigo', rotulo: 'Código', valor: item.codigo },
            { nome: 'descricao', rotulo: 'Descrição', valor: item.descricao },
          ],
          aoSalvar: async (id, valores) => {
            await chamarApi('/api/destinos', { metodo: 'PUT', corpo: { id, ...valores } });
            carregarDestinos();
          },
          aoDesativar: async (id) => {
            await chamarApi(`/api/destinos?id=${id}`, { metodo: 'DELETE' });
            carregarDestinos();
          },
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

// --- Motoristas (admin only) ------------------------------------------------
const RÓTULO_PAPEL = { admin: 'Administrador', operador_avancado: 'Operador Avançado', motorista: 'Motorista' };

async function carregarMotoristas() {
  if (sessao.usuario.role !== 'admin') return;
  try {
    const resultado = await chamarApi('/api/motoristas');
    const corpo = document.getElementById('lista-motoristas');
    corpo.innerHTML = '';
    for (const item of resultado.itens) {
      corpo.appendChild(
        linhaEditavel({
          id: item.id,
          textoExibicao: `${item.nome} (${RÓTULO_PAPEL[item.role] || item.role})`,
          campos: [
            { nome: 'nome', rotulo: 'Nome', valor: item.nome },
            {
              nome: 'role',
              rotulo: 'Papel',
              tipo: 'select',
              valor: item.role,
              opcoes: [
                { valor: 'motorista', rotulo: 'Motorista' },
                { valor: 'operador_avancado', rotulo: 'Operador Avançado' },
                { valor: 'admin', rotulo: 'Administrador' },
              ],
            },
          ],
          aoSalvar: async (id, valores) => {
            await chamarApi('/api/motoristas', { metodo: 'PUT', corpo: { id, ...valores } });
            carregarMotoristas();
          },
          aoDesativar: async (id) => {
            await chamarApi(`/api/motoristas?id=${id}`, { metodo: 'DELETE' });
            carregarMotoristas();
          },
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
