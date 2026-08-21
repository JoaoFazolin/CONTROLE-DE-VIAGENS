const { handleCrudCadastro } = require('../lib/crudCadastro');

// /api/escavadeiras — GET (todos autenticados) / POST, PUT, DELETE (admin)
exports.handler = (event) =>
  handleCrudCadastro(event, { table: 'escavadeiras', campo: 'codigo', campoLabel: 'o código da escavadeira' });
