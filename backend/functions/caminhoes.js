const { handleCrudCadastro } = require('../lib/crudCadastro');

// /api/caminhoes — GET (todos autenticados) / POST, PUT, DELETE (só admin).
// `motorista_id` (opcional) vincula o caminhão a um motorista fixo — usado
// pra travar/pré-preencher o campo "Caminhão"/"Motorista" no formulário de
// viagem. `volume`, `volume_empolamento` e `volume_aterro` (opcionais,
// digitados pelo admin) alimentam a aba "Resumo do dia" do relatório Excel.
exports.handler = (event) =>
  handleCrudCadastro(event, {
    table: 'caminhoes',
    campo: 'codigo',
    campoLabel: 'o código do caminhão',
    extras: ['motorista_id', 'volume', 'volume_empolamento', 'volume_aterro'],
    // migration_002: motorista_id é unique em caminhoes (um motorista só
    // pode estar vinculado a 1 caminhão) — sem isso, tentar vincular um
    // motorista já vinculado a outro caminhão devolveria por engano "já
    // existe um registro com esse código do caminhão".
    mensagensDuplicidade: {
      motorista_id: 'Esse motorista já está vinculado a outro caminhão. Remova o vínculo antigo antes de vincular aqui.',
    },
    // Desativar um caminhão libera o motorista que estava vinculado a ele —
    // sem isso, o vínculo ficava preso num caminhão escondido (que não
    // aparece mais em lugar nenhum) e esse motorista nunca mais podia ser
    // vinculado a outro caminhão (motorista_id é unique).
    limparAoDesativar: ['motorista_id'],
  });
