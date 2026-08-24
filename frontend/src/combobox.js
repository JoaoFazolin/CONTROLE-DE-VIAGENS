// Campo de seleção com busca de verdade: digita e filtra, em vez de rolar
// uma lista longa. Feito sem framework, com alvo de toque grande pra tablet.
//
// Uso:
//   const campo = criarCombobox({
//     container: document.getElementById('campo-caminhao'),
//     rotulo: 'Caminhão',
//     obrigatorio: true,
//     opcoes: [{ id: '...', texto: 'CB 236' }, ...],
//   });
//   campo.obterValor()      -> id selecionado (ou null)
//   campo.definirValor(id)  -> seleciona programaticamente
//   campo.definirOpcoes([]) -> atualiza a lista (ex: quando o cache recarrega)

export function criarCombobox({ container, rotulo, obrigatorio = false, placeholder = 'Digite para buscar…', opcoes = [] }) {
  let listaOpcoes = opcoes;
  let valorSelecionadoId = null;
  let indiceDestacado = -1;

  container.innerHTML = `
    <label>${rotulo}${obrigatorio ? ' *' : ''}</label>
    <div class="combobox">
      <input type="text" class="cb-input" placeholder="${placeholder}" autocomplete="off" inputmode="search" />
      <div class="combobox-lista"></div>
    </div>
  `;

  const input = container.querySelector('.cb-input');
  const lista = container.querySelector('.combobox-lista');

  function renderLista(filtro) {
    const termo = (filtro || '').trim().toLowerCase();
    const filtradas = termo
      ? listaOpcoes.filter((o) => o.texto.toLowerCase().includes(termo))
      : listaOpcoes;

    if (filtradas.length === 0) {
      lista.innerHTML = `<div class="combobox-vazio">Nenhum resultado.</div>`;
    } else {
      lista.innerHTML = filtradas
        .map(
          (o, i) =>
            `<div class="combobox-opcao ${i === indiceDestacado ? 'destacada' : ''}" data-id="${o.id}">${o.texto}</div>`
        )
        .join('');
    }
    lista.classList.add('aberta');

    lista.querySelectorAll('.combobox-opcao').forEach((el) => {
      el.addEventListener('click', () => selecionar(el.dataset.id));
    });
  }

  function fecharLista() {
    lista.classList.remove('aberta');
    indiceDestacado = -1;
  }

  function selecionar(id) {
    const opcao = listaOpcoes.find((o) => String(o.id) === String(id));
    if (!opcao) return;
    valorSelecionadoId = opcao.id;
    input.value = opcao.texto;
    fecharLista();
  }

  input.addEventListener('focus', () => renderLista(input.value === selecionarTexto() ? '' : input.value));
  input.addEventListener('input', () => {
    valorSelecionadoId = null;
    renderLista(input.value);
  });
  input.addEventListener('blur', () => {
    // pequeno atraso pra permitir o clique na opção antes de fechar
    setTimeout(() => {
      fecharLista();
      // se o texto digitado não bateu com nenhuma opção, limpa a seleção.
      // Atenção: valorSelecionadoId pode ser '' de propósito (ex: opção
      // "Todos" nos filtros) — só limpamos quando é null (nada escolhido).
      if (valorSelecionadoId === null) input.value = '';
    }, 150);
  });
  input.addEventListener('keydown', (ev) => {
    const itens = lista.querySelectorAll('.combobox-opcao');
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      indiceDestacado = Math.min(indiceDestacado + 1, itens.length - 1);
      renderLista(input.value);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      indiceDestacado = Math.max(indiceDestacado - 1, 0);
      renderLista(input.value);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const alvo = itens[indiceDestacado] || itens[0];
      if (alvo) selecionar(alvo.dataset.id);
    } else if (ev.key === 'Escape') {
      fecharLista();
    }
  });

  function selecionarTexto() {
    const opcao = listaOpcoes.find((o) => o.id === valorSelecionadoId);
    return opcao?.texto || '';
  }

  return {
    obterValor: () => valorSelecionadoId,
    definirValor(id) {
      selecionar(id);
    },
    limpar() {
      valorSelecionadoId = null;
      input.value = '';
    },
    definirOpcoes(novasOpcoes) {
      listaOpcoes = novasOpcoes;
    },
  };
}
