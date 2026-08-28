// Registro central pro botão "Atualizar" do cabeçalho: cada tela registra a
// própria função de recarregar os dados dela (cadastros, histórico, resumo
// do dia, filtros, dashboard...) sem o cabecalho precisar conhecer os
// detalhes de cada página.
const registrados = [];

export function registrarAtualizador(fn) {
  registrados.push(fn);
}

export async function dispararAtualizacao() {
  await Promise.all(
    registrados.map((fn) =>
      Promise.resolve()
        .then(fn)
        .catch((erro) => console.warn('Erro ao atualizar dados:', erro))
    )
  );
}
