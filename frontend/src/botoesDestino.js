// Grade de botões grandes para escolher o Destino — em vez de digitar e
// buscar, o motorista só toca no código certo. Pensado pra quem tem pouca
// prática com tecnologia: geralmente são poucos destinos fixos (AT.O,
// BF.O, AT.L...), então não precisa de campo de busca.
//
// Mesma "interface" do combobox (pra não precisar mudar o resto do código):
//   campo.obterValor()      -> id selecionado (ou null)
//   campo.definirValor(id)  -> seleciona programaticamente
//   campo.limpar()          -> tira a seleção
//   campo.obterTexto()      -> texto do destino selecionado (pra tela de confirmação)

export function criarBotoesDestino({ container, rotulo = 'Destino', obrigatorio = true, destinos = [] }) {
  let valorSelecionadoId = null;

  container.innerHTML = `
    <label>${rotulo}${obrigatorio ? ' *' : ''}</label>
    <div class="destino-grade"></div>
  `;

  const grade = container.querySelector('.destino-grade');

  if (!destinos.length) {
    grade.innerHTML = `<div class="combobox-vazio">Nenhum destino cadastrado.</div>`;
  } else {
    grade.innerHTML = destinos
      .map(
        (d) => `
          <button type="button" class="destino-botao" data-id="${d.id}">
            <span class="destino-codigo">${d.codigo}</span>
            ${d.descricao ? `<span class="destino-desc">${d.descricao}</span>` : ''}
          </button>
        `
      )
      .join('');

    grade.querySelectorAll('.destino-botao').forEach((el) => {
      el.addEventListener('click', () => selecionar(el.dataset.id));
    });
  }

  function selecionar(id) {
    const destino = destinos.find((d) => String(d.id) === String(id));
    if (!destino) return;
    valorSelecionadoId = destino.id;
    grade.querySelectorAll('.destino-botao').forEach((el) => {
      el.classList.toggle('selecionado', String(el.dataset.id) === String(destino.id));
    });
  }

  return {
    obterValor: () => valorSelecionadoId,
    definirValor(id) {
      if (id) selecionar(id);
    },
    limpar() {
      valorSelecionadoId = null;
      grade.querySelectorAll('.destino-botao').forEach((el) => el.classList.remove('selecionado'));
    },
    obterTexto() {
      const destino = destinos.find((d) => d.id === valorSelecionadoId);
      if (!destino) return '';
      return destino.descricao ? `${destino.codigo} — ${destino.descricao}` : destino.codigo;
    },
  };
}
