const { handleCrudCadastro } = require('../lib/crudCadastro');

// /api/caminhoes — GET (todos autenticados) / POST, PUT, DELETE (admin)
exports.handler = (event) =>
  handleCrudCadastro(event, { table: 'caminhoes', campo: 'codigo', campoLabel: 'o código do caminhão' });
