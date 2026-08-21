const { handleCrudCadastro } = require('../lib/crudCadastro');

// /api/locais-carga — GET (todos autenticados) / POST, PUT, DELETE (admin)
exports.handler = (event) =>
  handleCrudCadastro(event, { table: 'locais_carga', campo: 'nome', campoLabel: 'o nome do local' });
