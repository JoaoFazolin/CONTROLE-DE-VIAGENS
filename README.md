# Controle de Abastecimento de Combustível — L.R Campos Cia & Ltda

Sistema web para registrar e acompanhar o abastecimento de combustível dos
equipamentos, com controle de estoque do comboio, login individual por
usuário, e funcionamento offline no campo.

## Arquitetura

```
Tablet / Celular (4G/5G, com ou sem sinal)  ─┐
                                              ├──►  Netlify (site + funções) ──►  Supabase (banco de dados)
Computador do escritório                    ─┘
```

- **Netlify** hospeda o site e as Netlify Functions (o "backend").
- **Supabase** guarda os dados e cuida do login (Supabase Auth).
- O navegador nunca fala diretamente com o Supabase. Ele só chama
  `/api/...`. A `service_role key` (que dá acesso total ao banco) fica
  só nas variáveis de ambiente da Netlify — nunca aparece no F12.
- As tabelas no Supabase têm Row Level Security ativado **sem nenhuma
  policy pública**: só a service key (usada dentro da Netlify) consegue
  ler/gravar.

## Passo 1 — Banco de dados (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No **SQL Editor**, rode os scripts abaixo **nesta ordem exata** (um de
   cada vez, esperando cada um terminar antes do próximo). Se algum já
   tiver rodado antes em produção, pode pular — nenhum deles apaga dados
   já existentes:
   1. `supabase/schema.sql`
   2. `supabase/migration_002_estoque_usuarios.sql`
   3. `supabase/migration_003_operador_avancado.sql`
   4. `supabase/migration_005_oleo_lubrificante.sql`
   5. `supabase/migration_006_so_diesel.sql`
   6. `supabase/migration_007_evitar_duplicado.sql`
   7. `supabase/migration_008_hora_lancamento.sql`
   8. `supabase/migration_009_configuracoes.sql`
   9. `supabase/migration_010_marcador_atomico.sql`
   10. `supabase/migration_011_motoristas.sql`
   11. `supabase/migration_012_editar_cascata.sql`
3. Em **Project Settings → API**, anote:
   - **Project URL**
   - **anon public key**
   - **service_role key** (secreta)

### Criando o primeiro usuário administrador

1. Vá em **Authentication → Users → Add user** e crie seu usuário
   (e-mail + senha).
2. Volte ao **SQL Editor** e rode (trocando o e-mail pelo seu):

   ```sql
   insert into profiles (id, nome, role)
   select id, 'Seu Nome', 'admin' from auth.users
   where email = 'seuemail@exemplo.com';
   ```

3. Pronto — esse é seu login de administrador. Os demais operadores de
   campo podem ser criados depois direto na aba **Usuários** do próprio
   sistema (sem precisar mexer no Supabase de novo).

## Passo 2 — GitHub

```bash
cd controle-combustivel
git init
git add .
git commit -m "Sistema de controle de abastecimento"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/controle-combustivel.git
git push -u origin main
```

## Passo 3 — Netlify

1. **Add new site → Import an existing project** e escolha o repositório.
2. O `netlify.toml` já configura tudo — só clique em **Deploy**.
3. Em **Site configuration → Environment variables**, adicione:

   | Variável | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL do Supabase |
   | `SUPABASE_ANON_KEY` | anon public key do Supabase |
   | `SUPABASE_SERVICE_KEY` | service_role key do Supabase |

4. **Deploys → Trigger deploy** para aplicar as variáveis.

Seu site estará em `https://seu-site.netlify.app` (dá pra usar um domínio
próprio depois, em **Domain settings**).

## Login individual e permissões

Existem 3 papéis, configuráveis na aba **Usuários** (rode a
`migration_003_operador_avancado.sql` no Supabase antes de usar o papel novo):

- **Administrador**: acesso completo — cadastra equipamentos, obras e
  tipos de combustível/óleo (abas **Cadastrar Equipamentos**, **Obras**
  e **Cadastrar Óleo**); é o **único** que registra entradas do comboio
  (combustível e óleo) e o **único** que edita ou exclui um lançamento
  já salvo; cria e remove usuários; vê **Relatório** e **Relatório de
  Estoque** (cada um com seletor Combustível/Óleo) e o **Dashboard**.
- **Operador Avançado**: mesmo acesso completo do Administrador em
  quase todos os módulos (vê Cadastrar Equipamentos, Obras, Estoque —
  só consulta, sem registrar entrada —, Relatório, Relatório de
  Estoque, Dashboard), **exceto**: a aba **Usuários**, a aba
  **Cadastrar Óleo**, **registrar entrada de estoque** e **editar/
  excluir lançamentos** — essas 4 coisas agora são exclusivas do
  Administrador.
- **Operador**: tem uma tela **única e bem simples**, sem menu nenhum
  — só o formulário de lançamento. **Diesel vem fixo** (não precisa
  escolher combustível) e tem um botão do lado pra trocar pro modo
  **Óleo** (aí escolhe o tipo cadastrado). Os equipamentos aparecem só
  pelo número — ex: "CB 241" cadastrado pelo Admin aparece como "241"
  pro Operador (é só uma questão visual: o lançamento salvo e os
  relatórios continuam com o nome completo). O Marcador Inicial/Final
  não aparece na tela dele — continua sendo calculado sozinho por
  trás. **Ele também não escolhe a Obra** — todo lançamento dele usa
  automaticamente a "Obra Padrão" configurada pelo Administrador (aba
  **Configurações**). Antes de salvar de verdade, aparece uma janela
  pedindo para confirmar os dados digitados (Data, Motorista,
  Equipamento, Combustível/Óleo, Litros) — como ele **não edita nada
  depois**, essa conferência é a única chance de corrigir um erro de
  digitação. Ele não vê listas, relatórios nem estoque — só um
  contador pequeno no topo (ex: "2 pendente(s)") avisa se algum
  lançamento dele ainda está esperando internet para sincronizar.
- Cada usuário loga com seu próprio e-mail e senha (aba **Usuários**,
  só visível para administradores).
- A sessão fica **aberta por muito tempo**: o app renova o login
  sozinho, em segundo plano, sem pedir senha de novo. Só é preciso
  logar de novo se o aparelho ficar realmente muito tempo sem abrir o
  app.
- Cada lançamento guarda a **hora exata** em que foi feito (capturada
  no próprio celular, no momento de salvar) — não a hora em que
  sincronizou, caso tenha ficado esperando internet. Aparece nos
  relatórios e no Excel exportado.

## Configurações (Obra Padrão do Operador)

- Aba **Configurações**, só para o Administrador. Rode a
  `migration_009_configuracoes.sql` no Supabase antes de usar.
- Hoje só tem um ajuste: a **Obra Padrão**, usada automaticamente em
  todo lançamento feito pelo Operador (que não escolhe mais a obra na
  tela dele). Selecione a obra na lista e clique em **Salvar**.
- Se essa obra padrão nunca for configurada, o lançamento do Operador
  vai ser recusado pelo servidor pedindo pra configurar antes — é um
  aviso de segurança para não deixar lançamento salvo sem obra
  nenhuma. Configure isso **antes** de liberar o acesso para qualquer
  Operador.

## Marcador à prova de falha

- Rode a `migration_010_marcador_atomico.sql` no Supabase.
- A busca e o cálculo do Marcador Inicial/Final de um lançamento novo
  acontecem **dentro do banco de dados**, numa operação travada — o
  Postgres garante que, mesmo se dois lançamentos chegarem exatamente
  ao mesmo tempo (de aparelhos diferentes), um espera o outro terminar
  antes de calcular o próprio marcador. Isso elimina qualquer chance
  da corrente de marcadores quebrar, com ou sem internet.
- Se um lançamento no meio da lista tiver o Marcador Inicial ou os
  Litros editados pelo Administrador (aba **Editar**), o sistema
  **recalcula sozinho, em cascata, todos os lançamentos seguintes**
  daquele dia em diante — não precisa mais corrigir manualmente um por
  um. Isso vale até para "curar" um lançamento antigo que já estivesse
  sem marcador: basta editar o lançamento anterior a ele (mesmo sem
  mudar nada de verdade) que a corrente se refaz sozinha a partir dali.
  Rode a `migration_012_editar_cascata.sql` no Supabase para habilitar
  isso.

## Motoristas (cadastro e seleção)

- Rode a `migration_011_motoristas.sql` no Supabase.
- Nova aba **Motoristas** (gerente-only, junto de Cadastrar
  Equipamentos e Obras). O Administrador ou Operador Avançado cadastra
  o nome de cada motorista ali.
- Em **todo** formulário de lançamento — o completo (Admin/Operador
  Avançado) e o simplificado (Operador) — o campo "Operador/Motorista"
  deixou de ser texto livre e virou uma lista pra **selecionar**. Isso
  evita nome digitado errado ou diferente em cada lançamento.
- Internamente, o campo salvo continua sendo só o **nome** (texto),
  igual sempre foi — não muda nada na estrutura do banco nem quebra
  lançamentos antigos. Só passou a vir de uma lista fixa, em vez de
  digitado à mão.
- Detalhe: se um lançamento antigo tiver um nome que não está mais na
  lista de motoristas (por exemplo, alguém digitado antes dessa
  mudança, ou um motorista removido do cadastro depois), ao abrir esse
  lançamento em **Editar**, o campo aparece em branco (precisa
  escolher de novo) — o nome antigo continua salvo no lançamento em
  si, só não aparece pré-selecionado no formulário de edição.

## Km/Hora (Horímetro) na tela do Operador

- O campo **Km/Hora** — usado como horímetro/hodômetro manual — agora
  também aparece na tela simplificada do Operador, só no modo
  **Diesel** (óleo nunca teve esse campo, nem no formulário completo).
  É opcional, a pessoa digita o número que estiver vendo no
  equipamento na hora do lançamento.
- Continua sendo um número simples, sem cálculo nem memória entre
  lançamentos — diferente do Marcador de combustível, que é
  automático. Se quiser um horímetro de verdade (por equipamento, com
  histórico e cálculo automático), é uma função nova, ainda não
  construída.

## Estoque, Relatório e Relatório de Estoque

Essas 3 abas têm um seletor **Combustível / Óleo** no topo, pra não
precisar rolar a tela toda vez:

- **Estoque**: mostra o saldo atual e o formulário de "Registrar
  Entrada" (chegada do comboio) do tipo escolhido. Não tem histórico
  aqui — isso agora vive só no Relatório de Estoque.
- **Relatório**: relatório completo (filtros, cartões de estatística,
  tabela na tela, exportar Excel) dos **lançamentos** — de combustível
  ou de óleo, conforme o seletor.
- **Relatório de Estoque** (novo): mesma experiência completa, mas
  para as **entradas** de estoque (chegada do comboio) — de
  combustível ou de óleo.

## Controle de estoque de combustível (comboio)

- A empresa só usa **Diesel** — rode a `migration_006_so_diesel.sql` no
  Supabase para remover Gasolina e Álcool do cadastro (o script é
  seguro: só remove se nenhum lançamento/entrada/equipamento já usou
  esses dois; caso contrário só avisa, sem apagar nada).
- Na aba **Estoque**, **qualquer usuário logado** (inclusive Operador
  comum) pode registrar as entradas de combustível: por exemplo,
  "15/07/2026 — chegaram 3.500 L de Diesel". Excluir uma entrada já
  registrada continua restrito a quem gerencia (admin/operador
  avançado).
- O sistema calcula o **saldo atual automaticamente**: soma de todas as
  entradas menos a soma de todos os lançamentos (saídas) daquele
  combustível. Se o saldo cair abaixo do estoque mínimo configurado, o
  card fica destacado em vermelho com um alerta.
- No lançamento, o campo "Combustível" já vem preenchido com o padrão
  do equipamento escolhido, mas pode ser trocado se precisar.

## Controle de óleo lubrificante

Módulo paralelo ao de combustível, rode a `migration_005_oleo_lubrificante.sql`
no Supabase antes de usar. Duas diferenças importantes em relação ao
combustível:

- O **Lançamento de Óleo** não tem marcador inicial/final — só a
  quantidade (litros) usada no equipamento, que já abate direto do
  estoque de óleo.
- A **Entrada de Óleo** (dentro da aba **Estoque**, seletor "Óleo")
  pode ser registrada por **qualquer papel**, inclusive o Operador
  comum — diferente do combustível, onde só quem gerencia registra a
  chegada do comboio. (A
  exclusão de uma entrada já registrada continua só para quem
  gerencia.)
- O saldo de óleo é calculado do mesmo jeito que o de combustível:
  entradas menos lançamentos, com alerta se ficar abaixo do mínimo.
- Os tipos de óleo são cadastrados na aba **Cadastrar Óleo** (só
  Administrador), com nome e estoque mínimo opcional para o alerta.

## Funcionamento offline (PWA)

- O app pode ser **instalado** no tablet/celular: abra o site no
  Chrome, toque no menu e escolha "Adicionar à tela inicial" (ou o
  navegador vai sugerir isso automaticamente). Fica com ícone próprio,
  como um aplicativo normal.
- Se a conexão cair (ou ficar lenta demais) no meio do campo, o
  lançamento **não se perde**: ele fica guardado no próprio aparelho e
  aparece na lista como "⏳ Pendente". Vale tanto para lançamentos
  (combustível e óleo) quanto para entradas de estoque (chegada do
  comboio, combustível e óleo). Assim que a internet voltar, o sistema
  envia automaticamente (ou toque em "sincronizar" no topo da tela).
- Cada envio carrega uma identificação única gerada no aparelho, para
  que reenvios pela fila offline **nunca criem duplicado** — mesmo se
  a internet demorar tanto que o celular ache que falhou, mas o
  servidor já tiver salvo.
- As listas de equipamentos, obras e combustíveis também ficam
  guardadas no aparelho, então o formulário continua funcionando mesmo
  sem sinal — só a gravação final depende da internet.

## Relatório e Excel

- **Relatório** (lançamentos) e **Relatório de Estoque** (entradas)
  têm seletor Combustível/Óleo, cada um com sua própria tela completa
  e exportação em Excel — 4 relatórios ao todo.
- O relatório de **Lançamentos** filtra por equipamento, combustível/óleo,
  obra, operador e data ao mesmo tempo. No modo "Dia específico", mostra
  todos os equipamentos que abasteceram naquele dia.
- O relatório de **Entradas** filtra por período e tipo de combustível/óleo.
- Cada Excel exportado (`.xlsx`) tem múltiplas abas com fórmulas
  `SOMASE`/`CONT.SE` que recalculam se você editar os dados (ex.: o de
  Lançamentos tem Lançamentos + Resumo por Equipamento + Resumo por
  Combustível/Óleo; o de Entradas tem Entradas + Resumo por tipo).
- O nome do arquivo baixado já vem com o período filtrado (ex.:
  `relatorio-oleo-2026-07-01_a_2026-07-17.xlsx`).

## Dashboard

- Alterna entre **Dia** e **Mês**, mostra litros totais, número de
  lançamentos, e dois gráficos de barras: litros por equipamento e
  litros por tipo de combustível.

## Testar localmente (opcional)

```bash
npm install -g netlify-cli
cd controle-combustivel
npm install
netlify dev
```

Crie um `.env` na raiz (baseado em `.env.example`, com valores reais) —
o `netlify dev` carrega essas variáveis automaticamente, e o
`.gitignore` garante que ele nunca vai para o GitHub.
