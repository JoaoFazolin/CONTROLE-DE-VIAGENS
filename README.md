# LR Controle de Viagens

PWA para controle de viagens de caminhão da **LR Campos Cia & Ltda** — substitui a planilha de papel (caminhão, escavadeira, local da carga, destino, total de viagens, diesel, motorista), com lançamento offline em obra e sincronização automática.

Projeto **separado** do sistema de combustível do mesmo cliente (banco Supabase próprio).

## Estrutura do repositório

```
lr-controle-viagens/
├── frontend/         # PWA (HTML/CSS/JS puro, sem framework) — o que roda no navegador/tablet
│   ├── layout/        # cabeçalho/navegação compartilhados entre as telas
│   ├── styles/         # tema visual (cores, componentes)
│   ├── src/            # lógica: auth, api, fila offline, cadastros, páginas
│   ├── icons/           # ícones do PWA
│   ├── manifest.json, service-worker.js
│   └── *.html            # index (login), app (viagens), cadastros, relatorios
├── backend/          # Netlify Functions (Node.js) — uma function por endpoint
│   ├── functions/
│   └── lib/            # helpers compartilhados (auth, supabase, http)
├── server/           # Docker só para pré-visualizar o frontend estático
├── supabase/
│   ├── schema.sql                                  # schema base (rodar 1x)
│   └── migration_001_operador_avancado_e_edicao.sql # rodar depois do schema.sql
├── test-api.js       # diagnóstico rápido do backend (node test-api.js)
└── netlify.toml       # config de build/rotas da Netlify (precisa ficar na raiz)
```

## Arquitetura (replicando o padrão já validado)

- **Frontend**: HTML/CSS/JS puro, PWA instalável, funciona offline com fila de pendentes em `localStorage`.
- **Backend**: Netlify Functions — o frontend **nunca** fala direto com o Supabase, sempre passa por `/api/*`.
- **Banco**: Supabase (Postgres + Auth), RLS ativado em todas as tabelas, **sem políticas públicas** — só a `service_role key` (usada exclusivamente nas functions) lê/grava. O login em si usa a `anon key` (só ela; sozinha não dá acesso a nenhum dado, porque RLS bloqueia tudo sem a service key) — mesmo padrão do sistema de combustível já validado.
- **Login**: e-mail/senha via Supabase Auth. Sessão não expira sozinha: o frontend renova o `refresh_token` automaticamente em segundo plano (a cada 10 min e ao reconectar/reabrir o app).
- **Sequência de "Ordem"**: calculada dentro do banco com `pg_advisory_xact_lock`, numa função só (`criar_viagem`), evitando corrida quando dois lançamentos chegam juntos (ex: vários pendentes sincronizando ao mesmo tempo).
- **Hora do registro**: capturada no aparelho no momento de salvar (`registrado_em`), não na hora que sincronizou.

## Passo a passo do setup

### 1. Criar o projeto no Supabase

1. Crie um projeto novo no [supabase.com](https://supabase.com) (dedicado a este sistema).
2. Vá em **SQL Editor** e rode, nesta ordem, o conteúdo inteiro de:
   1. `supabase/schema.sql`
   2. `supabase/migration_001_operador_avancado_e_edicao.sql`
3. Em **Project Settings → API**, anote as três coisas:
   - **Project URL**
   - **anon public key**
   - **service_role key** (secreta — nunca vai pro frontend nem pro Git)

### 2. Criar o primeiro usuário administrador

O cadastro de motoristas pela tela **Cadastros** só funciona para quem já é admin — então o primeiro admin precisa ser criado manualmente, uma única vez:

1. No Supabase, vá em **Authentication → Users → Add user**, crie com e-mail e senha (marque **"Auto Confirm User"**, senão o login falha até alguém confirmar o e-mail).
2. No **SQL Editor**, rode (trocando o e-mail pelo que você acabou de criar):
   ```sql
   insert into public.profiles (id, nome, role, ativo)
   select id, 'Nome do Administrador', 'admin', true
   from auth.users
   where email = 'seuemail@exemplo.com';
   ```
3. A partir daí, esse admin consegue cadastrar todos os motoristas, caminhões, escavadeiras, locais e destinos direto pela tela do sistema.

### 3. Cadastrar os destinos (AT.O, BF.O, AT.L, etc.)

Na tela **Cadastros → Destinos**, o admin cadastra cada código com uma descrição livre (ex: `AT.O` → "Aterro - Obra"), para o motorista escolher pelo código na hora de lançar a viagem.

### 4. Deploy na Netlify

1. Suba este repositório para o GitHub/GitLab.
2. Na Netlify, **Add new site → Import an existing project**, aponte para o repo (o `netlify.toml` na raiz já configura tudo: publica `frontend/`, roda `backend/functions/`).
3. Em **Site settings → Environment variables**, adicione as três (nomes exatos, mesmos do sistema de combustível):

   | Variável | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL do Supabase |
   | `SUPABASE_ANON_KEY` | anon public key do Supabase |
   | `SUPABASE_SERVICE_KEY` | service_role key do Supabase |
4. Deploy (ou **Deploys → Trigger deploy** se o site já existia, pra aplicar as variáveis). O site fica disponível no domínio da Netlify (pode apontar um domínio próprio depois).

### 5. Desenvolvimento local

```bash
npm install -g netlify-cli   # se ainda não tiver
cd backend && npm install && cd ..
netlify dev                  # sobe frontend + functions juntos, lendo as env vars locais (.env)
```

Crie um `.env` na raiz (baseado em `.env.example`, com valores reais — nunca commitado, já está no `.gitignore`) com `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_KEY`.

Para só olhar o visual do frontend estático (sem backend funcionando), dá pra usar o Docker em `server/`:
```bash
cd server
docker compose up
# abre em http://localhost:8080
```

## Instalar como app (PWA)

No celular/tablet, abra o site no navegador (Chrome no Android é o mais confiável) e use **"Adicionar à tela inicial"**. No iPhone (Safari), também funciona, mas o iOS pode limpar dados guardados no navegador de forma imprevisível em uso offline prolongado — isso é uma limitação do próprio Safari, não do app. Para uso intenso em obra sem sinal por longos períodos, **Android é mais confiável**.

## Papéis de usuário

- **Motorista**: loga e lança as próprias viagens. Só vê/edita os próprios lançamentos (não vê Cadastros, Relatórios nem Dashboard).
- **Operador Avançado**: acesso quase igual ao admin — gerencia cadastros de caminhão/escavadeira/local/destino, lança viagem por qualquer motorista, vê Relatórios e Dashboard. **Não** gerencia Motoristas (usuários) e **não** edita/exclui viagens já lançadas — isso continua exclusivo do Administrador.
- **Administrador**: acesso total — tudo que o Operador Avançado faz, mais: cria/edita/desativa Motoristas (incluindo promover alguém a Operador Avançado), edita ou exclui qualquer viagem já lançada (inclusive corrigir manualmente o número da Ordem, se algum dia ficar errado).

Depois de rodar a `migration_001_operador_avancado_e_edicao.sql` (ver Passo 1), promova alguém a Operador Avançado direto pela tela **Cadastros → Motoristas → Editar**, ou pelo SQL Editor:
```sql
update public.profiles set role = 'operador_avancado'
where id = (select id from auth.users where email = 'email@exemplo.com');
```

## Editar e corrigir viagens

Na tela **Viagens → Histórico**, o Administrador tem botões **Editar** e **Excluir** em cada linha. Editar reabre o formulário do topo já preenchido (incluindo o campo **Ordem**, pra corrigir manualmente a sequência do dia se precisar) — é só ajustar e salvar. Antes de qualquer gravação (nova viagem ou edição), aparece uma tela de confirmação com os dados digitados, pra reduzir erro de digitação.

## Histórico, filtros e Dashboard

- A seção **Histórico de viagens** (tela Viagens) mostra os últimos 30 dias por padrão, com filtro de período e — pra quem gerencia — filtro por caminhão/motorista/destino. Carrega 50 de cada vez, com botão **Carregar mais**.
- A tela **Dashboard** (admin/Operador Avançado) mostra totais do período e três gráficos simples: viagens por dia, por caminhão e por destino.

## Relatório em Excel

Tela **Relatórios** (admin/Operador Avançado): escolhe um período e baixa um `.xlsx` com todas as viagens detalhadas numa aba, e os totais por dia (viagens, diesel, motoristas distintos) em outra aba.

## Testar se o backend está respondendo (diagnóstico rápido)

Depois de qualquer deploy, rode (precisa de Node 18+):
```bash
SITE_URL=https://seu-site.netlify.app EMAIL=seu@email.com SENHA=suasenha node test-api.js
```
Ele loga, testa a renovação de sessão, os cadastros, o resumo do dia e o dashboard, e imprime um resumo com ✅/❌ — mais rápido do que testar tela por tela depois de uma mudança.

## Fluxo Git sugerido

```
main   — sempre estável / produção
dev    — integração
feature/<nome> — uma branch por funcionalidade, a partir de dev
fix/<nome>     — correções de bugs
```

Commits seguindo [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`...).
