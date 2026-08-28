const { getSupabaseAdmin } = require('../lib/supabaseAdmin');
const { requireAuth, podeGerenciar } = require('../lib/auth');
const { json, noContentPreflight, safeJsonParse, comTratamentoDeErro } = require('../lib/http');

const TAMANHO_PAGINA = 50;

// /api/viagens
// GET  ?data=YYYY-MM-DD           -> lista as viagens daquele dia
// GET  ?inicio=...&fim=...        -> lista as viagens de um período (histórico/relatório),
//      aceita também caminhao_id, motorista_id, destino_id (filtros opcionais)
//      e offset (paginação, 50 por página — devolve tem_mais: true/false)
// POST { ... }                    -> cria uma viagem (motorista lança a própria,
//                                     admin/operador_avancado podem lançar por qualquer motorista)
// PUT  { id, ... }                -> corrige um registro, incluindo a Ordem manualmente (admin)
// DELETE ?id=...                  -> remove um registro (admin) — uso raro,
//                                     preferir corrigir com PUT
exports.handler = comTratamentoDeErro(async function (event) {
  if (event.httpMethod === 'OPTIONS') return noContentPreflight();
  const supabase = getSupabaseAdmin();

  const auth = await requireAuth(event);
  if (!auth.ok) return json(auth.statusCode, { erro: auth.message });

  if (event.httpMethod === 'GET') {
    const {
      data: dataParam,
      inicio,
      fim,
      caminhao_id: caminhaoIdFiltro,
      motorista_id: motoristaIdFiltro,
      destino_id: destinoIdFiltro,
      offset,
    } = event.queryStringParameters || {};

    let query = supabase
      .from('viagens')
      .select(
        `id, client_uuid, data, ordem, total_viagens, diesel_litros, registrado_em,
         caminhao:caminhoes(id, codigo),
         escavadeira:escavadeiras(id, codigo),
         local_carga:locais_carga(id, nome),
         destino:destinos(id, codigo, descricao),
         motorista:profiles!viagens_motorista_id_fkey(id, nome),
         operador:profiles!viagens_criado_por_fkey(id, nome)`,
        { count: 'exact' }
      )
      .order('data', { ascending: false })
      .order('ordem', { ascending: true });

    if (dataParam) {
      query = query.eq('data', dataParam);
    } else if (inicio && fim) {
      query = query.gte('data', inicio).lte('data', fim);
    } else {
      return json(400, { erro: 'Informe "data" ou "inicio" e "fim".' });
    }

    // Isolamento por quem está logado: um "motorista" (login raro, o comum é
    // o motorista nunca logar) só vê as viagens em que ele mesmo dirigiu; já
    // o "operador_avancado" (quem realmente loga e lança, na prática — o
    // operador da escavadeira, que seleciona caminhão e motorista a cada
    // carga) só vê o que ELE PRÓPRIO lançou, não importa qual motorista
    // escolheu naquele lançamento. Quem gerencia (admin) vê tudo.
    if (!podeGerenciar(auth.user)) {
      if (auth.user.role === 'motorista') {
        query = query.eq('motorista_id', auth.user.id);
      } else {
        query = query.eq('criado_por', auth.user.id);
      }
    }

    if (caminhaoIdFiltro) query = query.eq('caminhao_id', caminhaoIdFiltro);
    if (motoristaIdFiltro) query = query.eq('motorista_id', motoristaIdFiltro);
    if (destinoIdFiltro) query = query.eq('destino_id', destinoIdFiltro);

    const inicioOffset = Number(offset) || 0;
    query = query.range(inicioOffset, inicioOffset + TAMANHO_PAGINA - 1);

    const { data, error, count } = await query;
    if (error) return json(500, { erro: 'Erro ao buscar viagens.', detalhe: error.message });

    const temMais = count !== null && inicioOffset + TAMANHO_PAGINA < count;
    return json(200, { itens: data, total: count, tem_mais: temMais });
  }

  if (event.httpMethod === 'POST') {
    const body = safeJsonParse(event.body);
    if (!body) return json(400, { erro: 'JSON inválido.' });

    const {
      client_uuid,
      data: dataViagem,
      caminhao_id,
      escavadeira_id,
      local_carga_id,
      destino_id,
      total_viagens,
      diesel_litros,
      motorista_id,
      registrado_em,
    } = body;

    if (!client_uuid || !dataViagem || !caminhao_id || !destino_id || !motorista_id || !registrado_em) {
      return json(400, {
        erro: 'Campos obrigatórios ausentes (caminhão, destino, motorista, data e hora do registro).',
      });
    }

    // Só quem tem o cargo "motorista" (login raro, na prática o motorista
    // nunca abre o app) fica travado a lançar em nome dele mesmo. O
    // operador_avancado é quem realmente loga e lança na prática — ele
    // escolhe livremente qual motorista dirigiu cada carga (não é ele quem
    // dirige), e o admin também escolhe livremente.
    if (auth.user.role === 'motorista' && motorista_id !== auth.user.id) {
      return json(403, { erro: 'Você só pode lançar viagens em seu próprio nome.' });
    }

    const { data: row, error } = await supabase.rpc('criar_viagem', {
      p_client_uuid: client_uuid,
      p_data: dataViagem,
      p_caminhao_id: caminhao_id,
      p_escavadeira_id: escavadeira_id || null,
      p_local_carga_id: local_carga_id || null,
      p_destino_id: destino_id,
      p_total_viagens: total_viagens || 1,
      p_diesel_litros: diesel_litros ?? null,
      p_motorista_id: motorista_id,
      p_registrado_em: registrado_em,
      p_criado_por: auth.user.id,
    });

    if (error) return json(500, { erro: 'Erro ao gravar viagem.', detalhe: error.message });
    return json(201, { item: row });
  }

  if (event.httpMethod === 'PUT') {
    if (auth.user.role !== 'admin') return json(403, { erro: 'Só administradores podem corrigir viagens.' });

    const body = safeJsonParse(event.body);
    const id = body?.id;
    if (!id) return json(400, { erro: 'Informe o id da viagem.' });

    const campos = [
      'caminhao_id',
      'escavadeira_id',
      'local_carga_id',
      'destino_id',
      'total_viagens',
      'diesel_litros',
      'motorista_id',
      'ordem', // correção manual da sequência do dia, se algum dia ficar errada
    ];
    const payload = {};
    for (const campo of campos) {
      if (body[campo] !== undefined) payload[campo] = body[campo];
    }
    if (Object.keys(payload).length === 0) {
      return json(400, { erro: 'Nada para atualizar.' });
    }

    const { data, error } = await supabase.from('viagens').update(payload).eq('id', id).select().single();
    if (error) {
      // unique(data, ordem): já existe outra viagem com essa Ordem nesse dia.
      if (error.code === '23505') {
        return json(409, { erro: 'Já existe outra viagem com essa Ordem nesse dia. Escolha um número diferente.' });
      }
      return json(500, { erro: 'Erro ao atualizar viagem.', detalhe: error.message });
    }
    return json(200, { item: data });
  }

  if (event.httpMethod === 'DELETE') {
    if (auth.user.role !== 'admin') return json(403, { erro: 'Só administradores podem excluir viagens.' });

    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { erro: 'Informe o id da viagem.' });

    const { error } = await supabase.from('viagens').delete().eq('id', id);
    if (error) return json(500, { erro: 'Erro ao excluir viagem.', detalhe: error.message });
    return json(200, { ok: true });
  }

  return json(405, { erro: 'Método não permitido.' });
});
