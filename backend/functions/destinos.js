const { handleCrudCadastro } = require('../lib/crudCadastro');

// /api/destinos — GET (todos autenticados) / POST, PUT, DELETE (admin)
// codigo: ex "AT.O", "BF.O", "AT.L" — descricao: texto livre que o admin usa
// pra explicar o que o código significa (ex: "Aterro - Obra").
exports.handler = (event) =>
  handleCrudCadastro(event, {
    table: 'destinos',
    campo: 'codigo',
    campoLabel: 'o código do destino',
    extras: ['descricao'],
  });
