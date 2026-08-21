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
│   └── schema.sql     # schema completo do banco (rodar 1x no projeto Supabase)
└── netlify.toml       # config de build/rotas da Netlify (precisa ficar na raiz)
```

## Arquitetura (replicando o padrão já validado)

- **Frontend**: HTML/CSS/JS puro, PWA instalável, funciona offline com fila de pendentes em `localStorage`.
- **Backend**: Netlify Functions — o frontend **nunca** fala direto com o Supabase, sempre passa por `/api/*`.
- **Banco**: Supabase (Postgres + Auth), RLS ativado em todas as tabelas, **sem políticas públicas** — só a `service_role key` (usada exclusivamente nas functions) lê/grava.
- **Login**: e-mail/senha via Supabase Auth. Sessão não expira sozinha: o frontend renova o `refresh_token` automaticamente em segundo plano (a cada 10 min e ao reconectar/reabrir o app).
- **Sequência de "Ordem"**: calculada dentro do banco com `pg_advisory_xact_lock`, numa função só (`criar_viagem`), evitando corrida quando dois lançamentos chegam juntos (ex: vários pendentes sincronizando ao mesmo tempo).
- **Hora do registro**: capturada no aparelho no momento de salvar (`registrado_em`), não na hora que sincronizou.

## Passo a passo do setup

### 1. Criar o projeto no Supabase

1. Crie um projeto novo no [supabase.com](https://supabase.com) (dedicado a este sistema).
2. Vá em **SQL Editor** e rode o conteúdo inteiro de `supabase/schema.sql`.
3. Em **Project Settings → API**, anote a `Project URL` e a `service_role` key (secreta — nunca vai pro frontend nem pro Git).

### 2. Criar o primeiro usuário administrador

O cadastro de motoristas pela tela **Cadastros** só funciona para quem já é admin — então o primeiro admin precisa ser criado manualmente, uma única vez:

1. No Supabase, vá em **Authentication → Users → Add user**, crie com e-mail e senha.
2. Copie o `UUID` desse usuário.
3. No **SQL Editor**, rode:
   ```sql
   insert into public.profiles (id, nome, role, ativo)
   values ('COLE_O_UUID_AQUI', 'Nome do Administrador', 'admin', true);
   ```
4. A partir daí, esse admin consegue cadastrar todos os motoristas, caminhões, escavadeiras, locais e destinos direto pela tela do sistema.

### 3. Cadastrar os destinos (AT.O, BF.O, AT.L, etc.)

Na tela **Cadastros → Destinos**, o admin cadastra cada código com uma descrição livre (ex: `AT.O` → "Aterro - Obra"), para o motorista escolher pelo código na hora de lançar a viagem.

### 4. Deploy na Netlify

1. Suba este repositório para o GitHub/GitLab.
2. Na Netlify, **Add new site → Import an existing project**, aponte para o repo (o `netlify.toml` na raiz já configura tudo: publica `frontend/`, roda `backend/functions/`).
3. Em **Site settings → Environment variables**, adicione:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy. O site fica disponível no domínio da Netlify (pode apontar um domínio próprio depois).

### 5. Desenvolvimento local

```bash
npm install -g netlify-cli   # se ainda não tiver
cd backend && npm install && cd ..
netlify dev                  # sobe frontend + functions juntos, lendo as env vars locais (.env)
```

Crie um `.env` na raiz (nunca commitado — já está no `.gitignore`) com:
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Para só olhar o visual do frontend estático (sem backend funcionando), dá pra usar o Docker em `server/`:
```bash
cd server
docker compose up
# abre em http://localhost:8080
```

## Instalar como app (PWA)

No celular/tablet, abra o site no navegador (Chrome no Android é o mais confiável) e use **"Adicionar à tela inicial"**. No iPhone (Safari), também funciona, mas o iOS pode limpar dados guardados no navegador de forma imprevisível em uso offline prolongado — isso é uma limitação do próprio Safari, não do app. Para uso intenso em obra sem sinal por longos períodos, **Android é mais confiável**.

## Papéis de usuário

- **Motorista**: loga e lança as próprias viagens. Só vê/edita os próprios lançamentos.
- **Administrador**: acesso total — cadastra caminhões/escavadeiras/locais/destinos/motoristas, pode lançar viagem por qualquer motorista, corrige/exclui registros, exporta relatório em Excel.

## Relatório em Excel

Tela **Relatórios** (só admin): escolhe um período e baixa um `.xlsx` com todas as viagens detalhadas numa aba, e os totais por dia (viagens, diesel, motoristas distintos) em outra aba.

## Fluxo Git sugerido

```
main   — sempre estável / produção
dev    — integração
feature/<nome> — uma branch por funcionalidade, a partir de dev
fix/<nome>     — correções de bugs
```

Commits seguindo [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`...).
