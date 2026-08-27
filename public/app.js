const API = '/api';
const SESSION_KEY = 'session_v1';
const PENDING_KEY = 'pending_lancamentos_v1';

let equipamentos = [];
let obras = [];
let tiposCombustivel = [];
let tiposOleo = [];
let motoristas = [];
let editingId = null;
let relatorioMode = 'periodo';
let dashMode = 'dia';

/* ================= Helpers ================= */
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtNum(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function showToast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Pega o nome de arquivo real que o servidor sugeriu (já com o período
// filtrado embutido, ex: "relatorio-oleo-2026-07-01_a_2026-07-17.xlsx"),
// em vez de usar sempre um nome fixo genérico. Se por algum motivo o
// cabeçalho não vier, usa o nome padrão como reserva.
function filenameFromResponse(res, fallback) {
  const header = res.headers.get('Content-Disposition') || '';
  const match = header.match(/filename="?([^"]+)"?/);
  return match ? match[1] : fallback;
}

// ---- Modal de confirmação própria (substitui o confirm() do navegador) ----
// Uso: if (!(await confirmModal('Excluir este item?'))) return;
function confirmModal(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmMsg').textContent = message;
    overlay.classList.remove('hidden');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const cleanup = (result) => {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlayClick = (e) => { if (e.target === overlay) cleanup(false); };
    const onKeydown = (e) => { if (e.key === 'Escape') cleanup(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);
  });
}

/* ================= Sessão / Login ================= */
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
}
function setSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

function showLock(errMsg) {
  document.getElementById('appRoot').classList.add('hidden');
  document.getElementById('lockScreen').classList.remove('hidden');
  document.getElementById('lockError').textContent = errMsg || '';
}
function roleLabel(role) {
  if (role === 'admin') return 'Administrador';
  if (role === 'operador_avancado') return 'Operador Avançado';
  return 'Operador';
}
// "Gerencia" = admin ou operador_avancado: acesso a todos os módulos,
// exceto Usuários (que continua exclusivo do admin).
function isGerente(s) { return !!s && (s.role === 'admin' || s.role === 'operador_avancado'); }
function isAdmin(s) { return !!s && s.role === 'admin'; }

function showApp() {
  document.getElementById('lockScreen').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('hidden');
  const s = getSession();
  document.getElementById('userNome').textContent = s.nome;
  document.getElementById('userRole').textContent = roleLabel(s.role);
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin(s)));
  document.querySelectorAll('.gerente-only').forEach((el) => el.classList.toggle('hidden', !isGerente(s)));
  // "Mais" (barra de baixo, mobile) só faz sentido pra quem gerencia —
  // o Operador simples já vê tudo que precisa nos 3 ícones principais.
  const maisBtn = document.getElementById('btnMais');
  if (maisBtn) maisBtn.classList.toggle('hidden', !isGerente(s));

  // O Operador (papel básico) agora tem uma tela só, dedicada e bem simples
  // — sem menu nenhum, sem lista de lançamentos, sem estoque. Só o
  // formulário de lançamento + confirmação. Admin e Operador Avançado
  // continuam com a experiência completa de sempre.
  const ehOperadorSimples = s.role === 'operador';
  document.querySelector('nav.tabs').classList.toggle('hidden', ehOperadorSimples);
  document.querySelector('.bottom-nav').classList.toggle('hidden', ehOperadorSimples);
  if (ehOperadorSimples) {
    document.querySelectorAll('main > section').forEach((sec) => sec.classList.add('hidden'));
    document.getElementById('tab-lancamento-operador').classList.remove('hidden');
  } else {
    document.getElementById('tab-lancamento-operador').classList.add('hidden');
  }
}

async function tryEnter(email, password) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    let res;
    try {
      res = await fetch(API + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    const json = await res.json();
    if (res.ok && json.access_token) {
      setSession(json);
      showApp();
      init();
      return true;
    }
    document.getElementById('lockError').textContent = json.error || 'Não foi possível entrar.';
    return false;
  } catch (e) {
    document.getElementById('lockError').textContent = 'Erro de conexão. Verifique sua internet e tente novamente.';
    return false;
  }
}

document.getElementById('btnEntrar').addEventListener('click', () => {
  tryEnter(document.getElementById('emailInput').value.trim(), document.getElementById('passwordInput').value);
});
document.getElementById('passwordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryEnter(document.getElementById('emailInput').value.trim(), document.getElementById('passwordInput').value);
});
document.getElementById('btnSair').addEventListener('click', () => {
  clearSession();
  document.getElementById('emailInput').value = '';
  document.getElementById('passwordInput').value = '';
  showLock();
});

// ---- Manter logado por muito tempo ----
// O token de acesso do Supabase normalmente expira em ~1h. Em vez de
// derrubar a sessão nesse prazo, guardamos também o refresh_token e
// renovamos o access_token sozinhos, em segundo plano, sem pedir senha
// de novo. A pessoa só precisa logar de novo se ficar realmente muito
// tempo (semanas) sem abrir o app.
let refreshPromise = null;
async function refreshSession() {
  const s = getSession();
  if (!s || !s.refresh_token) return false;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      let res;
      try {
        res = await fetch(API + '/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: s.refresh_token }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const json = await res.json();
      if (!res.ok || !json.access_token) return false;
      setSession(Object.assign({}, getSession(), {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: json.expires_at
      }));
      return true;
    } catch (e) {
      return false;
    }
  })();
  const ok = await refreshPromise;
  refreshPromise = null;
  return ok;
}
// Renova de tempos em tempos sozinho, mesmo sem nenhuma ação da pessoa
// (ex.: app aberto em segundo plano no celular).
setInterval(() => { if (getSession()) refreshSession(); }, 10 * 60 * 1000);
// Quando o celular "acorda" o app (volta da tela bloqueada / outro app),
// aproveita para já renovar antes de qualquer chamada falhar.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && getSession()) refreshSession();
});

async function apiFetch(path, options = {}) {
  let s = getSession();
  // token perto de vencer (menos de 2 min): renova antes de usar
  if (s && s.expires_at && (s.expires_at * 1000 - Date.now() < 2 * 60 * 1000)) {
    await refreshSession();
    s = getSession();
  }
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    s ? { Authorization: 'Bearer ' + s.access_token } : {},
    options.headers || {}
  );
  // Tempo limite: em conexão fraca/instável (comum em obra), sem isso o
  // navegador pode ficar esperando resposta por muito tempo antes de
  // desistir sozinho. Com o tempo limite, cai rápido na fila offline em
  // vez de deixar a pessoa esperando sem saber o que está acontecendo.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch(API + path, Object.assign({}, options, { headers, signal: controller.signal }));
  } finally {
    clearTimeout(timeoutId);
  }
  if (res.status === 401) {
    // antes de desistir, tenta renovar a sessão uma vez e repetir a chamada
    const renovou = await refreshSession();
    if (renovou) {
      const s2 = getSession();
      const headers2 = Object.assign(
        { 'Content-Type': 'application/json' },
        { Authorization: 'Bearer ' + s2.access_token },
        options.headers || {}
      );
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 12000);
      try {
        res = await fetch(API + path, Object.assign({}, options, { headers: headers2, signal: controller2.signal }));
      } finally {
        clearTimeout(timeoutId2);
      }
    }
    if (res.status === 401) {
      clearSession();
      showLock('Sessão expirada. Faça login novamente.');
      throw new Error('unauthorized');
    }
  }
  return res;
}

// Lê o JSON de uma resposta que deve ser uma LISTA. Se a API falhou,
// lança erro com a mensagem real do servidor (em vez de quebrar em silêncio).
async function readJsonListOrThrow(res, nomeRecurso) {
  let body = null;
  try { body = await res.json(); } catch (e) { /* resposta vazia ou HTML (ex.: 404 da Netlify) */ }
  if (!res.ok) {
    const detalhe = (body && body.error) ? body.error : ('HTTP ' + res.status);
    throw new Error('Falha ao carregar ' + nomeRecurso + ': ' + detalhe);
  }
  if (!Array.isArray(body)) {
    throw new Error('Resposta inesperada da API ao carregar ' + nomeRecurso + '.');
  }
  return body;
}

// Extrai a mensagem de erro real de uma resposta (para mostrar no toast).
async function serverErrorMessage(res, fallback) {
  let body = null;
  try { body = await res.json(); } catch (e) { /* sem corpo JSON */ }
  return (body && body.error) ? body.error : (fallback + ' (HTTP ' + res.status + ')');
}

// Igual a readJsonListOrThrow, mas para respostas que devem ser um OBJETO
// (ex.: /api/dashboard). Antes, um erro do servidor aqui virava "undefined"
// espalhado pelos números da tela em vez de uma mensagem clara.
async function readJsonObjectOrThrow(res, nomeRecurso) {
  let body = null;
  try { body = await res.json(); } catch (e) { /* resposta vazia ou HTML */ }
  if (!res.ok) {
    const detalhe = (body && body.error) ? body.error : ('HTTP ' + res.status);
    throw new Error('Falha ao carregar ' + nomeRecurso + ': ' + detalhe);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Resposta inesperada da API ao carregar ' + nomeRecurso + '.');
  }
  return body;
}

async function boot() {
  const s = getSession();
  if (!s) { showLock(); return; }
  showApp();
  await init();
}

/* ================= Offline: banner + fila de pendentes ================= */
function updateOfflineBanner() {
  document.getElementById('offlineBanner').classList.toggle('hidden', navigator.onLine);
}
window.addEventListener('online', () => { updateOfflineBanner(); flushPending(); });
window.addEventListener('offline', updateOfflineBanner);

// Gera uma "impressão digital" única para cada lançamento/entrada NOVO,
// no momento em que a pessoa aperta Salvar. Ela viaja junto com os dados
// (inclusive se cair na fila offline e for reenviada depois) — assim o
// servidor sempre reconhece se aquele envio específico já foi salvo antes
// e nunca cria duplicado, mesmo em conexão lenta/instável.
function newClientRef() {
  return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

// Captura a hora local do próprio aparelho, no momento exato em que a
// pessoa aperta "Salvar" — não a hora em que o dado chega no servidor.
// Isso importa porque, sem internet, o lançamento pode ficar horas na
// fila esperando sincronizar; mesmo assim, a hora salva continua sendo
// a hora real em que a pessoa fez o lançamento.
function horaAgora() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (e) { return []; }
}
function setPending(list) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  updatePendingUI();
}
function enqueuePending(payload, tipo) {
  const list = getPending();
  // tipo: 'combustivel' (lançamento, padrão), 'oleo' (lançamento),
  // 'entrada_combustivel' ou 'entrada_oleo' (chegada do comboio). Itens
  // antigos, guardados antes desta versão, não têm o campo e são tratados
  // como lançamento de combustível.
  list.push({ localId: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), tipo: tipo || 'combustivel', payload, savedAt: Date.now() });
  setPending(list);
}
function updatePendingUI() {
  const list = getPending();
  const btn = document.getElementById('pendingBtn');
  document.getElementById('pendingCount').textContent = list.length;
  btn.classList.toggle('hidden', list.length === 0);

  // Mostra na aba Estoque, pra qualquer papel (inclusive Operador simples),
  // as entradas de combustível/lubrificante que ainda não sincronizaram — mesmo
  // sem acesso ao Relatório de Estoque (que é só pra quem gerencia), a
  // pessoa sempre consegue ver que o que ela registrou não se perdeu.
  const wrapCombustivel = document.getElementById('pendingEntradaCombustivel');
  if (wrapCombustivel) {
    wrapCombustivel.innerHTML = list.filter((p) => p.tipo === 'entrada_combustivel').map((p) => {
      const tipo = tiposCombustivel.find((t) => t.id === p.payload.tipo_combustivel_id);
      return `<div class="pending-item">
        ⏳ Pendente: ${fmtDateBR(p.payload.data)} · ${escapeHtml(tipo ? tipo.nome : 'combustível')} · ${fmtNum(p.payload.litros)} L
        ${p.lastError ? `<div style="color:var(--danger);margin-top:4px;">⚠ ${escapeHtml(p.lastError)}</div>` : ''}
      </div>`;
    }).join('');
  }
  const wrapOleo = document.getElementById('pendingEntradaOleo');
  if (wrapOleo) {
    wrapOleo.innerHTML = list.filter((p) => p.tipo === 'entrada_oleo').map((p) => {
      const tipo = tiposOleo.find((t) => t.id === p.payload.tipo_oleo_id);
      return `<div class="pending-item">
        ⏳ Pendente: ${fmtDateBR(p.payload.data)} · ${escapeHtml(tipo ? tipo.nome : 'lubrificante')} · ${fmtNum(p.payload.litros)} L
        ${p.lastError ? `<div style="color:var(--danger);margin-top:4px;">⚠ ${escapeHtml(p.lastError)}</div>` : ''}
      </div>`;
    }).join('');
  }
}
const ENDPOINT_POR_TIPO = {
  combustivel: '/lancamentos',
  oleo: '/lancamentos-oleo',
  entrada_combustivel: '/entradas',
  entrada_oleo: '/entradas-oleo'
};
async function flushPending() {
  if (!navigator.onLine) return;
  const list = getPending();
  if (list.length === 0) return;
  const remaining = [];
  let falhouAlgum = false;
  let sincronizouOleo = false;
  let sincronizouEntradaCombustivel = false;
  let sincronizouEntradaOleo = false;
  for (const item of list) {
    const endpoint = ENDPOINT_POR_TIPO[item.tipo] || '/lancamentos';
    try {
      const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(item.payload) });
      if (!res.ok) {
        // erro de validação/servidor (ex.: equipamento/obra apagados nesse meio tempo):
        // guarda a mensagem real para o usuário ver o motivo em vez de ficar tentando
        // pra sempre sem explicação nenhuma.
        item.lastError = await serverErrorMessage(res, 'Não foi possível sincronizar');
        remaining.push(item);
        falhouAlgum = true;
      } else if (item.tipo === 'oleo') {
        sincronizouOleo = true;
      } else if (item.tipo === 'entrada_combustivel') {
        sincronizouEntradaCombustivel = true;
      } else if (item.tipo === 'entrada_oleo') {
        sincronizouEntradaOleo = true;
      }
    } catch (e) {
      remaining.push(item); // ainda sem rede, conexão instável, ou sessão expirada
    }
  }
  setPending(remaining);
  if (remaining.length < list.length) {
    showToast(`${list.length - remaining.length} item(ns) pendente(s) sincronizado(s).`);
    await renderEntries();
    if (sincronizouOleo) await renderEntriesOleo();
    if (sincronizouEntradaCombustivel) { await renderReportEntradas(); renderEstoque(); }
    if (sincronizouEntradaOleo) { await renderReportEntradasOleo(); renderEstoqueOleo(); }
    if (isGerente(getSession())) {
      renderReport();
      if (sincronizouOleo) renderReportOleo();
      renderDashboard();
    }
  } else if (falhouAlgum) {
    // atualiza as listas para exibir o motivo do erro em cada item preso
    await renderEntries();
    await renderEntriesOleo();
    if (isGerente(getSession())) {
      await renderReportEntradas();
      await renderReportEntradasOleo();
    }
  }
}
document.getElementById('pendingBtn').addEventListener('click', flushPending);
setInterval(flushPending, 30000);

/* ================= Tabs ================= */
// Funciona com qualquer botão que tenha data-tab: menu de cima (desktop),
// barra fixa de baixo (mobile) e a folha "Mais" — todos ficam sincronizados.
function irParaAba(nomeAba) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === nomeAba));
  ['lancamento', 'equipamentos', 'obras', 'motoristas', 'estoque', 'lancamento-oleo', 'tipos-oleo', 'relatorio', 'relatorio-estoque', 'dashboard', 'usuarios', 'configuracoes'].forEach((t) => {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== nomeAba);
  });
  if (nomeAba === 'relatorio') { renderReport(); renderReportOleo(); }
  if (nomeAba === 'relatorio-estoque') { renderReportEntradas(); renderReportEntradasOleo(); }
  if (nomeAba === 'dashboard') renderDashboard();
  if (nomeAba === 'estoque') { renderEstoque(); renderEstoqueOleo(); }
  if (nomeAba === 'tipos-oleo') renderTiposOleo();
  if (nomeAba === 'usuarios') renderUsuarios();
  if (nomeAba === 'configuracoes') carregarConfiguracoes();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  fecharSheetMais();
}
document.querySelectorAll('[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => irParaAba(btn.dataset.tab));
});

// ---- Seletores Combustível/Lubrificante (Estoque, Relatório, Relatório de Estoque) ----
document.querySelectorAll('.mode-btn[data-emode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn[data-emode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const modo = btn.dataset.emode;
    document.getElementById('estoqueViewCombustivel').classList.toggle('hidden', modo !== 'combustivel');
    document.getElementById('estoqueViewOleo').classList.toggle('hidden', modo !== 'oleo');
  });
});

document.querySelectorAll('.mode-btn[data-rmode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn[data-rmode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const modo = btn.dataset.rmode;
    document.getElementById('relatorioViewCombustivel').classList.toggle('hidden', modo !== 'combustivel');
    document.getElementById('relatorioViewOleo').classList.toggle('hidden', modo !== 'oleo');
  });
});

document.querySelectorAll('.mode-btn[data-remode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn[data-remode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const modo = btn.dataset.remode;
    document.getElementById('relatorioEstoqueViewCombustivel').classList.toggle('hidden', modo !== 'combustivel');
    document.getElementById('relatorioEstoqueViewOleo').classList.toggle('hidden', modo !== 'oleo');
  });
});

// ---- Folha "Mais" (mobile): mostra as abas de cadastro/gestão que não
// cabem na barra fixa de baixo. Só aparece pra quem gerencia (admin ou
// operador avançado) — o Operador simples já tem tudo na barra principal.
function abrirSheetMais() { document.getElementById('maisSheetOverlay').classList.remove('hidden'); }
function fecharSheetMais() { document.getElementById('maisSheetOverlay').classList.add('hidden'); }
const btnMais = document.getElementById('btnMais');
if (btnMais) btnMais.addEventListener('click', abrirSheetMais);
const fecharSheetBtn = document.getElementById('fecharSheetMais');
if (fecharSheetBtn) fecharSheetBtn.addEventListener('click', fecharSheetMais);
const maisSheetOverlay = document.getElementById('maisSheetOverlay');
if (maisSheetOverlay) maisSheetOverlay.addEventListener('click', (e) => { if (e.target === maisSheetOverlay) fecharSheetMais(); });

document.getElementById('syncBtn').addEventListener('click', async () => {
  const icon = document.getElementById('syncIcon');
  icon.classList.add('spin');
  const s = getSession();
  await loadCadastros();
  if (s && s.role === 'operador') {
    // nada de listas/relatórios pra ele — só garante que as opções do
    // formulário (obra/equipamento/lubrificante) estão atualizadas.
    setTimeout(() => icon.classList.remove('spin'), 500);
    showToast('Dados atualizados.');
    return;
  }
  await renderEntries();
  await renderEntriesOleo();
  if (isGerente(s)) {
    renderReport();
    renderReportOleo();
    renderReportEntradas();
    renderReportEntradasOleo();
    renderDashboard();
  }
  renderEstoque();
  renderEstoqueOleo();
  setTimeout(() => icon.classList.remove('spin'), 500);
  showToast('Dados atualizados.');
});

/* ================= Cadastros (equipamentos / obras / tipos de combustivel) ================= */
async function loadCadastros() {
  // Cada cadastro é carregado de forma independente: se um endpoint falha,
  // os demais ainda preenchem seus seletores, e o erro real aparece no toast.
  const erros = [];
  async function tentar(path, nome) {
    try {
      return await readJsonListOrThrow(await apiFetch(path), nome);
    } catch (e) {
      if (e.message !== 'unauthorized') erros.push(e.message);
      return null;
    }
  }
  const [eq, ob, tc, to, mt] = await Promise.all([
    tentar('/equipamentos', 'equipamentos'),
    tentar('/obras', 'obras'),
    tentar('/tipos-combustivel', 'tipos de combustível'),
    tentar('/tipos-oleo', 'tipos de lubrificante'),
    tentar('/motoristas', 'motoristas')
  ]);
  if (eq) equipamentos = eq;
  if (ob) obras = ob;
  if (tc) tiposCombustivel = tc;
  if (to) tiposOleo = to;
  if (mt) motoristas = mt;
  populateSelects();
  renderEquipamentos();
  renderObras();
  renderMotoristas();
  if (erros.length) showToast(erros[0], true);
}

function renderEquipamentos() {
  const wrap = document.getElementById('listaEquipamentos');
  if (equipamentos.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><span class="em-icon">🛠</span>Nenhum equipamento cadastrado ainda.</div>';
    return;
  }
  wrap.innerHTML = equipamentos.map((eq) => `
    <div class="list-item">
      <span class="name">${escapeHtml(eq.nome)} ${eq.tipos_combustivel ? `<span class="role-tag" style="color:var(--muted)">· ${escapeHtml(eq.tipos_combustivel.nome)}</span>` : ''}</span>
      <button class="del" data-id="${eq.id}">Remover</button>
    </div>`).join('');
  wrap.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmModal('Remover este equipamento?'))) return;
    try {
      const res = await apiFetch('/equipamentos?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao remover equipamento'), true); return; }
      await loadCadastros();
      showToast('Equipamento removido.');
    } catch (e) { if (e.message !== 'unauthorized') showToast('Erro ao remover.', true); }
  }));
}

function renderObras() {
  const wrap = document.getElementById('listaObras');
  if (obras.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><span class="em-icon">🏗</span>Nenhuma obra cadastrada ainda.</div>';
    return;
  }
  wrap.innerHTML = obras.map((o) => `
    <div class="list-item">
      <span class="name">${escapeHtml(o.nome)}</span>
      <button class="del" data-id="${o.id}">Remover</button>
    </div>`).join('');
  wrap.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmModal('Remover esta obra?'))) return;
    try {
      const res = await apiFetch('/obras?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao remover obra'), true); return; }
      await loadCadastros();
      showToast('Obra removida.');
    } catch (e) { if (e.message !== 'unauthorized') showToast('Erro ao remover.', true); }
  }));
}

function renderMotoristas() {
  const wrap = document.getElementById('listaMotoristas');
  if (!wrap) return;
  if (motoristas.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><span class="em-icon">🧑‍✈️</span>Nenhum motorista cadastrado ainda.</div>';
    return;
  }
  wrap.innerHTML = motoristas.map((m) => `
    <div class="list-item">
      <span class="name">${escapeHtml(m.nome)}</span>
      <button class="del" data-id="${m.id}">Remover</button>
    </div>`).join('');
  wrap.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmModal('Remover este motorista?'))) return;
    try {
      const res = await apiFetch('/motoristas?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao remover motorista'), true); return; }
      await loadCadastros();
      showToast('Motorista removido.');
    } catch (e) { if (e.message !== 'unauthorized') showToast('Erro ao remover.', true); }
  }));
}

async function renderTiposOleo() {
  const wrap = document.getElementById('listaTiposOleo');
  try {
    const res = await apiFetch('/tipos-oleo');
    const list = await readJsonListOrThrow(res, 'tipos de lubrificante');
    if (list.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><span class="em-icon">🛢</span>Nenhum tipo de lubrificante cadastrado ainda.</div>';
      return;
    }
    wrap.innerHTML = list.map((t) => `
      <div class="list-item">
        <span class="name">${escapeHtml(t.nome)} ${t.estoque_minimo ? `<span class="role-tag" style="color:var(--muted)">· mínimo ${fmtNum(t.estoque_minimo)} L</span>` : ''}</span>
        <button class="del" data-id="${t.id}">Remover</button>
      </div>`).join('');
    wrap.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmModal('Remover este tipo de lubrificante? Lançamentos e entradas antigas continuam salvos, mas ele deixa de aparecer nos seletores.'))) return;
      try {
        const res = await apiFetch('/tipos-oleo?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
        if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao remover tipo de lubrificante.'), true); return; }
        await loadCadastros();
        await renderTiposOleo();
        showToast('Tipo de lubrificante removido.');
      } catch (e) { if (e.message !== 'unauthorized') showToast('Erro ao remover.', true); }
    }));
  } catch (e) {
    if (e.message !== 'unauthorized') wrap.innerHTML = `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar tipos de lubrificante.')}</div>`;
  }
}

document.getElementById('btnAddEquipamento').addEventListener('click', async () => {
  const input = document.getElementById('novoEquipamento');
  const tipoSel = document.getElementById('novoEquipamentoTipo');
  const nome = input.value.trim();
  if (!nome) { showToast('Digite o nome do equipamento.', true); return; }
  try {
    const res = await apiFetch('/equipamentos', { method: 'POST', body: JSON.stringify({ nome, tipo_combustivel_id: tipoSel.value || null }) });
    if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao adicionar equipamento.'), true); return; }
    input.value = ''; tipoSel.value = '';
    await loadCadastros();
    showToast('Equipamento adicionado.');
  } catch (e) { if (e.message !== 'unauthorized') showToast('Erro de conexão ao adicionar equipamento.', true); }
});

const btnAddTipoOleo = document.getElementById('btnAddTipoOleo');
if (btnAddTipoOleo) {
  btnAddTipoOleo.addEventListener('click', async () => {
    const input = document.getElementById('novoTipoOleo');
    const minInput = document.getElementById('novoTipoOleoMinimo');
    const nome = input.value.trim();
    if (!nome) { showToast('Digite o nome do tipo de lubrificante.', true); return; }
    try {
      const res = await apiFetch('/tipos-oleo', { method: 'POST', body: JSON.stringify({ nome, estoque_minimo: minInput.value || 0 }) });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao adicionar tipo de lubrificante.'), true); return; }
      input.value = ''; minInput.value = '';
      await loadCadastros();
      await renderTiposOleo();
      showToast('Tipo de lubrificante adicionado.');
    } catch (e) { if (e.message !== 'unauthorized') showToast('Erro de conexão ao adicionar tipo de lubrificante.', true); }
  });
}

document.getElementById('btnAddObra').addEventListener('click', async () => {
  const input = document.getElementById('novaObra');
  const nome = input.value.trim();
  if (!nome) { showToast('Digite o nome da obra.', true); return; }
  try {
    const res = await apiFetch('/obras', { method: 'POST', body: JSON.stringify({ nome }) });
    if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao adicionar obra.'), true); return; }
    input.value = '';
    await loadCadastros();
    showToast('Obra adicionada.');
  } catch (e) { if (e.message !== 'unauthorized') showToast('Erro de conexão ao adicionar obra.', true); }
});

const btnAddMotorista = document.getElementById('btnAddMotorista');
if (btnAddMotorista) {
  btnAddMotorista.addEventListener('click', async () => {
    const input = document.getElementById('novoMotorista');
    const nome = input.value.trim();
    if (!nome) { showToast('Digite o nome do motorista.', true); return; }
    try {
      const res = await apiFetch('/motoristas', { method: 'POST', body: JSON.stringify({ nome }) });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao adicionar motorista.'), true); return; }
      input.value = '';
      await loadCadastros();
      showToast('Motorista adicionado.');
    } catch (e) { if (e.message !== 'unauthorized') showToast('Erro de conexão ao adicionar motorista.', true); }
  });
}

function populateSelects() {
  const obraOpts = ['<option value="">Selecione a obra...</option>'].concat(obras.map((o) => `<option value="${o.id}">${escapeHtml(o.nome)}</option>`));
  const tcOpts = ['<option value="">Selecione o combustível...</option>'].concat(tiposCombustivel.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`));
  // Motorista: o "value" de cada opção é o próprio NOME (não um id) —
  // o campo "operador" continua sendo texto simples no banco, igual
  // sempre foi, só que agora escolhido de uma lista em vez de digitado.
  const motoristaOpts = ['<option value="">Selecione o motorista...</option>'].concat(motoristas.map((m) => `<option value="${escapeHtml(m.nome)}">${escapeHtml(m.nome)}</option>`));

  const fObra = document.getElementById('f_obra'), fTc = document.getElementById('f_tipoCombustivel'), fOp = document.getElementById('f_operador');
  const curObra = fObra.value, curTc = fTc.value, curFOp = fOp.value;
  fObra.innerHTML = obraOpts.join(''); fTc.innerHTML = tcOpts.join(''); fOp.innerHTML = motoristaOpts.join('');
  fObra.value = curObra; fTc.value = curTc; fOp.value = curFOp;
  if (buscaEquipamentoAdmin) buscaEquipamentoAdmin.refresh();

  const rObra = document.getElementById('r_obra'), rEq = document.getElementById('r_equipamento'), rTc = document.getElementById('r_tipoCombustivel');
  const curRObra = rObra.value, curREq = rEq.value, curRTc = rTc.value;
  rObra.innerHTML = '<option value="">Todas</option>' + obras.map((o) => `<option value="${o.id}">${escapeHtml(o.nome)}</option>`).join('');
  rEq.innerHTML = '<option value="">Todos</option>' + equipamentos.map((e) => `<option value="${e.id}">${escapeHtml(e.nome)}</option>`).join('');
  rTc.innerHTML = '<option value="">Todos</option>' + tiposCombustivel.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');
  rObra.value = curRObra; rEq.value = curREq; rTc.value = curRTc;

  const novoTipo = document.getElementById('novoEquipamentoTipo');
  novoTipo.innerHTML = '<option value="">Combustível padrão (opcional)</option>' + tiposCombustivel.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');

  const eTipo = document.getElementById('e_tipo');
  if (eTipo) eTipo.innerHTML = tiposCombustivel.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');

  const enTipo = document.getElementById('en_tipo');
  if (enTipo) {
    const curEnTipo = enTipo.value;
    enTipo.innerHTML = '<option value="">Todos</option>' + tiposCombustivel.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');
    enTipo.value = curEnTipo;
  }

  // ---- Módulo de Lubrificante ----
  const foObra = document.getElementById('fo_obra'), foTo = document.getElementById('fo_tipoOleo'), foOp = document.getElementById('fo_operador');
  if (foObra) {
    const curFoObra = foObra.value, curFoTo = foTo.value, curFoOp = foOp.value;
    foObra.innerHTML = obraOpts.join('');
    foTo.innerHTML = ['<option value="">Selecione o lubrificante...</option>'].concat(tiposOleo.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`)).join('');
    foOp.innerHTML = motoristaOpts.join('');
    foObra.value = curFoObra; foTo.value = curFoTo; foOp.value = curFoOp;
    if (buscaEquipamentoOleo) buscaEquipamentoOleo.refresh();
  }

  const eoTipo = document.getElementById('eo_tipo');
  if (eoTipo) eoTipo.innerHTML = tiposOleo.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');

  const enoTipo = document.getElementById('eno_tipo');
  if (enoTipo) {
    const curEnoTipo = enoTipo.value;
    enoTipo.innerHTML = '<option value="">Todos</option>' + tiposOleo.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');
    enoTipo.value = curEnoTipo;
  }

  const roObra = document.getElementById('ro_obra'), roEq = document.getElementById('ro_equipamento'), roTipo = document.getElementById('ro_tipo');
  if (roObra) {
    const curRoObra = roObra.value, curRoEq = roEq.value, curRoTipo = roTipo.value;
    roObra.innerHTML = '<option value="">Todas</option>' + obras.map((o) => `<option value="${o.id}">${escapeHtml(o.nome)}</option>`).join('');
    roEq.innerHTML = '<option value="">Todos</option>' + equipamentos.map((e) => `<option value="${e.id}">${escapeHtml(e.nome)}</option>`).join('');
    roTipo.innerHTML = '<option value="">Todos</option>' + tiposOleo.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');
    roObra.value = curRoObra; roEq.value = curRoEq; roTipo.value = curRoTipo;
  }

  // ---- Tela simplificada do Operador ----
  // O equipamento aqui aparece só com o número (ex: "CB 241" -> "241"),
  // pra facilitar visualmente. É só o TEXTO exibido — o value do <option>
  // continua sendo o id de verdade do equipamento, então o lançamento
  // salvo e os relatórios continuam com o nome completo normalmente.
  // (A obra não aparece mais aqui — o Operador não escolhe mais isso, o
  // servidor preenche sozinho com a "obra padrão" configurada pelo Admin.)
  const opTo = document.getElementById('op_tipoOleo'), opOp = document.getElementById('op_operador');
  if (opTo) {
    const curOpTo = opTo.value, curOpOp = opOp.value;
    opTo.innerHTML = ['<option value="">Selecione o lubrificante...</option>'].concat(tiposOleo.map((t) => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`)).join('');
    opOp.innerHTML = motoristaOpts.join('');
    opTo.value = curOpTo; opOp.value = curOpOp;
    if (buscaEquipamentoOperador) buscaEquipamentoOperador.refresh();
  }

  // ---- Configurações (admin) ----
  const cfgObra = document.getElementById('cfg_obraPadrao');
  if (cfgObra) {
    const curCfgObra = cfgObra.value;
    cfgObra.innerHTML = '<option value="">Selecione a obra...</option>' + obras.map((o) => `<option value="${o.id}">${escapeHtml(o.nome)}</option>`).join('');
    cfgObra.value = curCfgObra;
  }
}

// Extrai só o número do nome do equipamento, pra mostrar de forma mais
// simples e visual pro Operador (ex: "CB 241" -> "241", "EH-123" -> "123").
// Se o nome não tiver nenhum número, mostra o nome completo mesmo, pra
// nunca deixar a opção sem texto nenhum.
function numeroEquipamento(nome) {
  const m = String(nome || '').match(/(\d+)(?!.*\d)/);
  return m ? m[1] : nome;
}

// ---- Campo de Equipamento com busca (digitar e filtrar) ----
// Reaproveitado nos 3 formulários de lançamento (combustível completo,
// lubrificante completo, e a tela simplificada do Operador). Cada campo vira 3
// elementos juntos: um <input type=text> visível pra digitar/buscar, um
// <input type=hidden> que guarda o id de verdade do equipamento (é esse
// que é lido na hora de montar o lançamento), e uma lista de sugestões
// que aparece embaixo, filtrando conforme a pessoa digita.
function criarBuscaEquipamento(prefixo, getTextoExibir, onSelecionar) {
  const busca = document.getElementById(prefixo + '_busca');
  const hidden = document.getElementById(prefixo);
  const lista = document.getElementById(prefixo + '_lista');
  if (!busca || !hidden || !lista) return null;

  function opcoesFiltradas(termo) {
    const t = (termo || '').toLowerCase().trim();
    if (!t) return equipamentos;
    // busca sempre pelo nome completo (ex: "CB 241"), mesmo quando o que
    // aparece na tela é só o número — assim a pessoa pode digitar tanto
    // o prefixo ("CB") quanto o número ("241") pra achar o equipamento.
    return equipamentos.filter((e) => (e.nome || '').toLowerCase().includes(t));
  }

  function mostrarLista(termo) {
    const opcoes = opcoesFiltradas(termo);
    if (opcoes.length === 0) {
      lista.innerHTML = '<div class="autocomplete-empty">Nenhum equipamento encontrado.</div>';
    } else {
      lista.innerHTML = opcoes.map((e) => `<div class="autocomplete-item" data-id="${e.id}">${escapeHtml(getTextoExibir(e))}</div>`).join('');
      lista.querySelectorAll('.autocomplete-item').forEach((el) => {
        // mousedown (não click) para disparar ANTES do blur do campo de
        // texto — senão a lista já teria sumido antes do toque registrar.
        el.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const eq = equipamentos.find((e) => e.id === el.dataset.id);
          if (eq) {
            hidden.value = eq.id;
            busca.value = getTextoExibir(eq);
            if (onSelecionar) onSelecionar(eq);
          }
          lista.classList.add('hidden');
        });
      });
    }
    lista.classList.remove('hidden');
  }

  busca.addEventListener('focus', () => mostrarLista(busca.value));
  busca.addEventListener('input', () => {
    hidden.value = ''; // só fica valido de novo quando escolher um item da lista
    mostrarLista(busca.value);
  });
  busca.addEventListener('blur', () => {
    setTimeout(() => {
      lista.classList.add('hidden');
      // se saiu do campo sem escolher nada válido da lista, limpa o texto
      // digitado — evita salvar um equipamento "errado" só por parecer certo.
      if (!hidden.value) busca.value = '';
    }, 150);
  });

  return {
    setValue(id) {
      const eq = equipamentos.find((e) => e.id === id);
      hidden.value = id || '';
      busca.value = eq ? getTextoExibir(eq) : '';
    },
    clear() {
      hidden.value = '';
      busca.value = '';
    },
    // chamado depois que a lista de equipamentos é recarregada (ex: admin
    // cadastrou/renomeou algo) — atualiza o texto exibido se necessário.
    refresh() {
      if (hidden.value) {
        const eq = equipamentos.find((e) => e.id === hidden.value);
        if (eq) busca.value = getTextoExibir(eq);
      }
    }
  };
}

const buscaEquipamentoAdmin = criarBuscaEquipamento('f_equipamento', (e) => e.nome, (eq) => {
  // mesmo comportamento de antes: ao escolher o equipamento, preenche
  // sozinho o combustível padrão dele (se tiver um configurado).
  if (eq.tipo_combustivel_id) document.getElementById('f_tipoCombustivel').value = eq.tipo_combustivel_id;
});
const buscaEquipamentoOleo = criarBuscaEquipamento('fo_equipamento', (e) => e.nome, null);
const buscaEquipamentoOperador = criarBuscaEquipamento('op_equipamento', (e) => numeroEquipamento(e.nome), null);

// ---- Autopreenchimento GLOBAL do Marcador Inicial ----
// O "marcador" aqui é o contador do próprio comboio/bico de abastecimento,
// não o hodômetro de cada equipamento — então ele sobe sempre, não importa
// em qual equipamento o combustível foi colocado. Por isso o Marcador
// Inicial do próximo lançamento é sempre o Marcador Final do ÚLTIMO
// lançamento registrado, de QUALQUER equipamento.
let marcadorFetchToken = 0;
async function autofillMarcadorInicial() {
  const campo = document.getElementById('f_marcInicial');
  if (!campo || editingId) return; // nunca mexe durante edição de um lançamento já salvo
  const meuToken = ++marcadorFetchToken;
  try {
    const res = await apiFetch('/lancamentos');
    const list = await readJsonListOrThrow(res, 'histórico de lançamentos');
    if (meuToken !== marcadorFetchToken) return; // uma chamada mais nova já está em andamento
    if (list.length === 0) return;
    // a API devolve em ordem crescente de data/criação; o último item é o mais recente de todos
    const ultimo = list[list.length - 1];
    if (ultimo.marcador_final != null) {
      campo.value = ultimo.marcador_final;
      calcularMarcadorFinal();
    }
  } catch (e) {
    // autopreenchimento é só uma conveniência: se falhar, o formulário continua
    // funcionando normalmente e o usuário pode digitar o marcador manualmente.
  }
}

// ---- Cálculo automático do Marcador Final ----
// Marcador Final = Marcador Inicial + Litros abastecidos. A pessoa não
// digita mais esse campo — ele é só leitura e se recalcula sozinho toda
// vez que o Marcador Inicial ou os Litros mudam.
function calcularMarcadorFinal() {
  const iniEl = document.getElementById('f_marcInicial');
  const litEl = document.getElementById('f_litros');
  const finalEl = document.getElementById('f_marcFinal');
  const ini = parseFloat(iniEl.value);
  const lit = parseFloat(litEl.value);
  if (!isNaN(ini) && !isNaN(lit)) {
    finalEl.value = (ini + lit).toFixed(2).replace(/\.00$/, '').replace(/(\.\d*[1-9])0$/, '$1');
  } else {
    finalEl.value = '';
  }
}
document.getElementById('f_marcInicial').addEventListener('input', calcularMarcadorFinal);
document.getElementById('f_litros').addEventListener('input', calcularMarcadorFinal);

function nomeObra(l) { return l.obras ? l.obras.nome : '—'; }
function nomeEquip(l) { return l.equipamentos ? l.equipamentos.nome : '—'; }
function nomeTipo(l) { return l.tipos_combustivel ? l.tipos_combustivel.nome : '—'; }

/* ================= Lançamento ================= */
function resetForm() {
  document.getElementById('f_data').value = todayISO();
  document.getElementById('f_operador').value = '';
  document.getElementById('f_obra').value = '';
  if (buscaEquipamentoAdmin) buscaEquipamentoAdmin.clear();
  document.getElementById('f_tipoCombustivel').value = '';
  document.getElementById('f_marcInicial').value = '';
  document.getElementById('f_marcFinal').value = '';
  document.getElementById('f_litros').value = '';
  document.getElementById('f_kmhora').value = '';
  editingId = null;
  document.getElementById('formTitle').textContent = 'Novo Lançamento de Combustível';
  document.getElementById('btnSalvar').textContent = 'Salvar Lançamento';
  document.getElementById('btnCancelarEdicao').classList.add('hidden');
  autofillMarcadorInicial();
}
document.getElementById('btnCancelarEdicao').addEventListener('click', resetForm);

document.getElementById('btnSalvar').addEventListener('click', async () => {
  const payload = {
    data: document.getElementById('f_data').value,
    hora: horaAgora(),
    operador: document.getElementById('f_operador').value.trim(),
    obra_id: document.getElementById('f_obra').value,
    equipamento_id: document.getElementById('f_equipamento').value,
    tipo_combustivel_id: document.getElementById('f_tipoCombustivel').value,
    marcador_inicial: document.getElementById('f_marcInicial').value,
    marcador_final: document.getElementById('f_marcFinal').value,
    litros: document.getElementById('f_litros').value,
    km_hora: document.getElementById('f_kmhora').value
  };

  if (!payload.data) { showToast('Informe a data.', true); return; }
  if (!payload.obra_id) { showToast('Selecione a obra.', true); return; }
  if (!payload.equipamento_id) { showToast('Selecione o equipamento.', true); return; }
  if (!payload.tipo_combustivel_id) { showToast('Selecione o combustível.', true); return; }
  if (!payload.operador) { showToast('Informe o operador/motorista.', true); return; }
  if (payload.litros === '' || Number(payload.litros) <= 0) { showToast('Informe os litros de saída (maior que zero).', true); return; }
  if (payload.marcador_inicial !== '' && payload.marcador_final !== '' && Number(payload.marcador_final) < Number(payload.marcador_inicial)) {
    showToast('O marcador final não pode ser menor que o inicial.', true);
    return;
  }

  if (editingId) {
    try {
      const res = await apiFetch('/lancamentos?id=' + encodeURIComponent(editingId), { method: 'PUT', body: JSON.stringify(payload) });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao atualizar lançamento'), true); return; }
      const atualizado = await res.json();
      const qtdCascata = (atualizado._atualizadosEmCascata || 1) - 1;
      showToast(qtdCascata > 0
        ? `Lançamento atualizado — e mais ${qtdCascata} lançamento(s) seguinte(s) recalculado(s) automaticamente.`
        : 'Lançamento atualizado.');
      resetForm();
      await renderEntries();
      if (isGerente(getSession())) {
        renderReport();
        renderDashboard();
      }
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Erro ao atualizar lançamento.', true);
    }
    return;
  }

  // Novo lançamento: tenta salvar; se nao tiver rede, guarda na fila offline
  payload.client_ref = newClientRef();
  try {
    const res = await apiFetch('/lancamentos', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao salvar lançamento'), true); return; }
    showToast('Lançamento salvo.');
    resetForm();
    await renderEntries();
    if (isGerente(getSession())) {
      renderReport();
      renderDashboard();
    }
  } catch (e) {
    if (e.message === 'unauthorized') return;
    enqueuePending(payload);
    showToast('Sem conexão — lançamento guardado neste aparelho e será enviado quando a internet voltar.', true);
    resetForm();
  }
});

async function renderEntries() {
  const wrap = document.getElementById('entriesList');
  const s = getSession();
  try {
    const res = await apiFetch('/lancamentos');
    const list = (await readJsonListOrThrow(res, 'lançamentos')).slice().reverse().slice(0, 25);
    // só os pendentes de combustível — os de lubrificante aparecem na lista de lubrificante
    const pending = getPending().filter((p) => p.tipo !== 'oleo');

    const pendingHtml = pending.map((p) => `
      <div class="pending-item">
        ⏳ Pendente: ${fmtDateBR(p.payload.data)} · ${escapeHtml(p.payload.operador)} · ${fmtNum(p.payload.litros)} L
        ${p.lastError ? `<div style="color:var(--danger);margin-top:4px;">⚠ ${escapeHtml(p.lastError)}</div>` : ''}
      </div>`).join('');

    if (list.length === 0 && pending.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><span class="em-icon">⛽</span>Nenhum lançamento registrado ainda.</div>';
      return;
    }

    wrap.innerHTML = pendingHtml + list.map((l) => {
      // agora editar/excluir lançamento é exclusivo do Administrador —
      // nem Operador Avançado, nem Operador (mesmo o que ele mesmo criou).
      const podeEditar = isAdmin(s);
      const podeExcluir = isAdmin(s);
      const acoes = (podeEditar || podeExcluir) ? `
        <div class="entry-actions">
          ${podeEditar ? `<button class="edit" data-id="${l.id}">Editar</button>` : ''}
          ${podeExcluir ? `<button class="del" data-id="${l.id}">Excluir</button>` : ''}
        </div>` : '';
      return `
      <div class="entry-card">
        <div class="entry-top">
          <div>
            <div class="eq">${escapeHtml(nomeEquip(l))}</div>
            <div class="meta">${fmtDateBR(l.data)} · ${escapeHtml(nomeObra(l))} · ${escapeHtml(nomeTipo(l))} · ${escapeHtml(l.operador)}</div>
          </div>
          <span class="odo">${fmtNum(l.litros)} L</span>
        </div>
        <div class="entry-grid">
          <div><div class="k">Marc. Inicial</div><span class="odo">${l.marcador_inicial != null ? fmtNum(l.marcador_inicial) : '—'}</span></div>
          <div><div class="k">Marc. Final</div><span class="odo">${l.marcador_final != null ? fmtNum(l.marcador_final) : '—'}</span></div>
          <div><div class="k">Km/Hora</div>${fmtNum(l.km_hora)}</div>
          <div><div class="k">Litros</div>${fmtNum(l.litros)}</div>
        </div>
        ${acoes}
      </div>`;
    }).join('');

    {
      wrap.querySelectorAll('.edit').forEach((b) => b.addEventListener('click', () => {
        const l = list.find((x) => x.id === b.dataset.id);
        if (!l) return;
        editingId = l.id;
        document.getElementById('f_data').value = l.data;
        document.getElementById('f_operador').value = l.operador;
        document.getElementById('f_obra').value = l.obra_id || '';
        if (buscaEquipamentoAdmin) buscaEquipamentoAdmin.setValue(l.equipamento_id || '');
        document.getElementById('f_tipoCombustivel').value = l.tipo_combustivel_id || '';
        document.getElementById('f_marcInicial').value = l.marcador_inicial ?? '';
        document.getElementById('f_marcFinal').value = l.marcador_final ?? '';
        document.getElementById('f_litros').value = l.litros ?? '';
        document.getElementById('f_kmhora').value = l.km_hora ?? '';
        document.getElementById('formTitle').textContent = 'Editar Lançamento de Combustível';
        document.getElementById('btnSalvar').textContent = 'Atualizar Lançamento';
        document.getElementById('btnCancelarEdicao').classList.remove('hidden');
        document.getElementById('tab-lancamento').scrollIntoView({ behavior: 'smooth' });
      }));
      wrap.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmModal('Excluir este lançamento?'))) return;
        try {
          const res = await apiFetch('/lancamentos?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
          if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao excluir lançamento'), true); return; }
          await renderEntries();
          if (isGerente(getSession())) {
            renderReport();
            renderDashboard();
          }
          showToast('Lançamento excluído.');
        } catch (e) { if (e.message !== 'unauthorized') showToast('Erro ao excluir.', true); }
      }));
    }
  } catch (e) {
    if (e.message !== 'unauthorized') {
      // mesmo sem conseguir carregar do servidor (ex.: sem internet),
      // mostra os pendentes guardados no aparelho para a pessoa ver
      // que o lançamento dela não sumiu.
      const pendHtml = getPending().filter((p) => p.tipo !== 'oleo').map((p) => `
        <div class="pending-item">
          ⏳ Pendente: ${fmtDateBR(p.payload.data)} · ${escapeHtml(p.payload.operador)} · ${fmtNum(p.payload.litros)} L
          ${p.lastError ? `<div style="color:var(--danger);margin-top:4px;">⚠ ${escapeHtml(p.lastError)}</div>` : ''}
        </div>`).join('');
      wrap.innerHTML = pendHtml + `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar lançamentos.')}</div>`;
    }
  }
}

/* ================= Estoque ================= */
async function renderEstoque() {
  const wrap = document.getElementById('estoqueCards');
  try {
    const res = await apiFetch('/estoque');
    const list = await readJsonListOrThrow(res, 'estoque');
    if (list.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Nenhum tipo de combustível cadastrado.</div>';
      return;
    }
    wrap.innerHTML = list.map((t) => `
      <div class="estoque-card ${t.abaixoDoMinimo ? 'low' : ''}">
        <div>
          <div class="nome">${escapeHtml(t.nome)}</div>
          <div class="detalhe">Entradas: ${fmtNum(t.totalEntradas)} L · Saídas: ${fmtNum(t.totalSaidas)} L</div>
          ${t.abaixoDoMinimo ? `<div class="alerta">Abaixo do mínimo (${fmtNum(t.estoqueMinimo)} L)</div>` : ''}
        </div>
        <div class="saldo">${fmtNum(t.saldoAtual)} L</div>
      </div>`).join('');
  } catch (e) {
    if (e.message !== 'unauthorized') wrap.innerHTML = `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar estoque.')}</div>`;
  }
}

function buildFiltroEntradasParams() {
  const params = new URLSearchParams();
  const de = document.getElementById('en_de') ? document.getElementById('en_de').value : '';
  const ate = document.getElementById('en_ate') ? document.getElementById('en_ate').value : '';
  const tipo = document.getElementById('en_tipo') ? document.getElementById('en_tipo').value : '';
  if (de) params.set('de', de);
  if (ate) params.set('ate', ate);
  if (tipo) params.set('tipo_combustivel_id', tipo);
  return params;
}

async function renderReportEntradas() {
  const wrap = document.getElementById('reportEntradasTableWrap');
  const pending = getPending().filter((p) => p.tipo === 'entrada_combustivel');
  const pendHtml = pending.map((p) => {
    const tipo = tiposCombustivel.find((t) => t.id === p.payload.tipo_combustivel_id);
    return `<div class="pending-item">
      ⏳ Pendente: ${fmtDateBR(p.payload.data)} · ${escapeHtml(tipo ? tipo.nome : 'combustível')} · ${fmtNum(p.payload.litros)} L
      ${p.lastError ? `<div style="color:var(--danger);margin-top:4px;">⚠ ${escapeHtml(p.lastError)}</div>` : ''}
    </div>`;
  }).join('');
  try {
    const params = buildFiltroEntradasParams();
    const qs = params.toString();
    const res = await apiFetch('/entradas' + (qs ? '?' + qs : ''));
    const list = await readJsonListOrThrow(res, 'relatório de entradas');

    document.getElementById('statEntradasCount').textContent = list.length + pending.length;
    const totalLitros = list.reduce((s, e) => s + (Number(e.litros) || 0), 0) + pending.reduce((s, p) => s + (Number(p.payload.litros) || 0), 0);
    document.getElementById('statEntradasLitros').textContent = totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

    if (list.length === 0 && !pendHtml) {
      wrap.innerHTML = '<div class="empty-state"><span class="em-icon">📄</span>Nenhuma entrada encontrada para este filtro.</div>';
      return;
    }

    const s = getSession();
    const canDelete = isGerente(s);
    wrap.innerHTML = pendHtml + `
      <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Data</th><th>Combustível</th><th>Litros</th><th>Fornecedor</th><th>Nota Fiscal</th><th>Observação</th>${canDelete ? '<th></th>' : ''}
        </tr></thead>
        <tbody>
          ${list.map((e) => `
            <tr>
              <td>${fmtDateBR(e.data)}</td>
              <td>${escapeHtml(e.tipos_combustivel ? e.tipos_combustivel.nome : '—')}</td>
              <td>${fmtNum(e.litros)}</td>
              <td>${escapeHtml(e.fornecedor || '—')}</td>
              <td>${escapeHtml(e.nota_fiscal || '—')}</td>
              <td>${escapeHtml(e.observacao || '—')}</td>
              ${canDelete ? `<td><button class="del" data-id="${e.id}">Remover</button></td>` : ''}
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="2">Total</td><td>${totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L</td><td colspan="${canDelete ? 4 : 3}"></td></tr></tfoot>
      </table>
      </div>`;
    if (canDelete) {
      wrap.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmModal('Remover esta entrada?'))) return;
        try {
          const res = await apiFetch('/entradas?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
          if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao remover entrada'), true); return; }
          await renderReportEntradas();
          renderEstoque();
          showToast('Entrada removida.');
        } catch (e) { if (e.message !== 'unauthorized') showToast('Erro ao remover.', true); }
      }));
    }
  } catch (e) {
    if (e.message !== 'unauthorized') {
      // mesmo sem conseguir carregar do servidor (ex.: sem internet), mostra
      // os pendentes guardados no aparelho para a pessoa ver que a entrada
      // que ela registrou não sumiu.
      wrap.innerHTML = pendHtml + `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar relatório.')}</div>`;
      document.getElementById('statEntradasCount').textContent = '—';
      document.getElementById('statEntradasLitros').textContent = '—';
    }
  }
}

const btnFiltrarEntradas = document.getElementById('btnFiltrarEntradas');
if (btnFiltrarEntradas) btnFiltrarEntradas.addEventListener('click', renderReportEntradas);

const btnExportarEntradas = document.getElementById('btnExportarEntradas');
if (btnExportarEntradas) {
  btnExportarEntradas.addEventListener('click', async () => {
    try {
      const params = buildFiltroEntradasParams();
      const res = await apiFetch('/export-entradas?' + params.toString());
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao gerar o Excel.'), true); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFromResponse(res, 'entradas-estoque-combustivel.xlsx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Relatório de entradas baixado.');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Erro ao exportar.', true);
    }
  });
}

const btnSalvarEntrada = document.getElementById('btnSalvarEntrada');
if (btnSalvarEntrada) {
  btnSalvarEntrada.addEventListener('click', async () => {
    const payload = {
      data: document.getElementById('e_data').value,
      tipo_combustivel_id: document.getElementById('e_tipo').value,
      litros: document.getElementById('e_litros').value,
      fornecedor: document.getElementById('e_fornecedor').value.trim(),
      nota_fiscal: document.getElementById('e_notaFiscal').value.trim(),
      observacao: document.getElementById('e_obs').value.trim()
    };
    if (!payload.data) { showToast('Informe a data.', true); return; }
    if (!payload.tipo_combustivel_id) { showToast('Selecione o combustível.', true); return; }
    if (!payload.litros || Number(payload.litros) <= 0) { showToast('Informe os litros recebidos (maior que zero).', true); return; }
    payload.client_ref = newClientRef();
    try {
      const res = await apiFetch('/entradas', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao registrar entrada'), true); return; }
      document.getElementById('e_data').value = todayISO();
      document.getElementById('e_litros').value = '';
      document.getElementById('e_fornecedor').value = '';
      document.getElementById('e_notaFiscal').value = '';
      document.getElementById('e_obs').value = '';
      await renderReportEntradas();
      renderEstoque();
      showToast('Entrada registrada.');
    } catch (e) {
      if (e.message === 'unauthorized') return;
      // sem rede ou conexão instável: guarda na fila offline, igual ao lançamento
      enqueuePending(payload, 'entrada_combustivel');
      document.getElementById('e_data').value = todayISO();
      document.getElementById('e_litros').value = '';
      document.getElementById('e_fornecedor').value = '';
      document.getElementById('e_notaFiscal').value = '';
      document.getElementById('e_obs').value = '';
      await renderReportEntradas();
      showToast('Sem conexão — entrada guardada neste aparelho e será enviada quando a internet voltar.', true);
    }
  });
}

/* ================= Lubrificante Lubrificante ================= */

// ---- Lançamento de Lubrificante (sem marcador inicial/final, só a quantidade) ----
let editingIdOleo = null;

function resetFormOleo() {
  document.getElementById('fo_data').value = todayISO();
  document.getElementById('fo_operador').value = '';
  document.getElementById('fo_obra').value = '';
  if (buscaEquipamentoOleo) buscaEquipamentoOleo.clear();
  document.getElementById('fo_tipoOleo').value = '';
  document.getElementById('fo_litros').value = '';
  editingIdOleo = null;
  document.getElementById('formTitleOleo').textContent = 'Novo Lançamento de Lubrificante';
  document.getElementById('btnSalvarOleo').textContent = 'Salvar Lançamento';
  document.getElementById('btnCancelarEdicaoOleo').classList.add('hidden');
}
document.getElementById('btnCancelarEdicaoOleo').addEventListener('click', resetFormOleo);

document.getElementById('btnSalvarOleo').addEventListener('click', async () => {
  const payload = {
    data: document.getElementById('fo_data').value,
    hora: horaAgora(),
    operador: document.getElementById('fo_operador').value.trim(),
    obra_id: document.getElementById('fo_obra').value,
    equipamento_id: document.getElementById('fo_equipamento').value,
    tipo_oleo_id: document.getElementById('fo_tipoOleo').value,
    litros: document.getElementById('fo_litros').value
  };
  if (!payload.data) { showToast('Informe a data.', true); return; }
  if (!payload.obra_id) { showToast('Selecione a obra.', true); return; }
  if (!payload.equipamento_id) { showToast('Selecione o equipamento.', true); return; }
  if (!payload.tipo_oleo_id) { showToast('Selecione o tipo de lubrificante.', true); return; }
  if (!payload.operador) { showToast('Informe o operador/motorista.', true); return; }
  if (!payload.litros || Number(payload.litros) <= 0) { showToast('Informe a quantidade de lubrificante (maior que zero).', true); return; }

  if (editingIdOleo) {
    try {
      const res = await apiFetch('/lancamentos-oleo?id=' + encodeURIComponent(editingIdOleo), { method: 'PUT', body: JSON.stringify(payload) });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao atualizar lançamento de lubrificante'), true); return; }
      showToast('Lançamento de lubrificante atualizado.');
      resetFormOleo();
      await renderEntriesOleo();
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Erro ao atualizar lançamento de lubrificante.', true);
    }
    return;
  }

  payload.client_ref = newClientRef();
  try {
    const res = await apiFetch('/lancamentos-oleo', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao salvar lançamento de lubrificante'), true); return; }
    showToast('Lançamento de lubrificante salvo.');
    resetFormOleo();
    await renderEntriesOleo();
  } catch (e) {
    if (e.message === 'unauthorized') return;
    // sem rede: guarda na mesma fila offline do combustível, marcado como lubrificante
    enqueuePending(payload, 'oleo');
    showToast('Sem conexão — lançamento de lubrificante guardado neste aparelho e será enviado quando a internet voltar.', true);
    resetFormOleo();
    await renderEntriesOleo();
  }
});

function nomeObraOleo(l) { return l.obras ? l.obras.nome : '—'; }
function nomeEquipOleo(l) { return l.equipamentos ? l.equipamentos.nome : '—'; }
function nomeTipoOleo(l) { return l.tipos_oleo ? l.tipos_oleo.nome : '—'; }

function pendingOleoHtml() {
  return getPending().filter((p) => p.tipo === 'oleo').map((p) => `
    <div class="pending-item">
      ⏳ Pendente: ${fmtDateBR(p.payload.data)} · ${escapeHtml(p.payload.operador)} · ${fmtNum(p.payload.litros)} L
      ${p.lastError ? `<div style="color:var(--danger);margin-top:4px;">⚠ ${escapeHtml(p.lastError)}</div>` : ''}
    </div>`).join('');
}

async function renderEntriesOleo() {
  const wrap = document.getElementById('entriesOleoList');
  const s = getSession();
  try {
    const res = await apiFetch('/lancamentos-oleo');
    const list = (await readJsonListOrThrow(res, 'lançamentos de lubrificante')).slice().reverse().slice(0, 25);
    const pendHtml = pendingOleoHtml();

    if (list.length === 0 && !pendHtml) {
      wrap.innerHTML = '<div class="empty-state">Nenhum lançamento de lubrificante ainda.</div>';
      return;
    }

    wrap.innerHTML = pendHtml + list.map((l) => {
      // editar/excluir lançamento de lubrificante agora é exclusivo do Administrador.
      const podeEditar = isAdmin(s);
      const podeExcluir = isAdmin(s);
      const acoes = (podeEditar || podeExcluir) ? `
        <div class="entry-actions">
          ${podeEditar ? `<button class="edit-oleo" data-id="${l.id}">Editar</button>` : ''}
          ${podeExcluir ? `<button class="del-oleo" data-id="${l.id}">Excluir</button>` : ''}
        </div>` : '';
      return `
      <div class="entry-card">
        <div class="entry-top">
          <div>
            <div class="eq">${escapeHtml(nomeEquipOleo(l))}</div>
            <div class="meta">${fmtDateBR(l.data)} · ${escapeHtml(nomeObraOleo(l))} · ${escapeHtml(nomeTipoOleo(l))} · ${escapeHtml(l.operador)}</div>
          </div>
          <span class="odo">${fmtNum(l.litros)} L</span>
        </div>
        ${acoes}
      </div>`;
    }).join('');

    wrap.querySelectorAll('.edit-oleo').forEach((b) => b.addEventListener('click', () => {
      const l = list.find((x) => x.id === b.dataset.id);
      if (!l) return;
      editingIdOleo = l.id;
      document.getElementById('fo_data').value = l.data;
      document.getElementById('fo_operador').value = l.operador;
      document.getElementById('fo_obra').value = l.obra_id || '';
      if (buscaEquipamentoOleo) buscaEquipamentoOleo.setValue(l.equipamento_id || '');
      document.getElementById('fo_tipoOleo').value = l.tipo_oleo_id || '';
      document.getElementById('fo_litros').value = l.litros ?? '';
      document.getElementById('formTitleOleo').textContent = 'Editar Lançamento de Lubrificante';
      document.getElementById('btnSalvarOleo').textContent = 'Atualizar Lançamento';
      document.getElementById('btnCancelarEdicaoOleo').classList.remove('hidden');
      document.getElementById('tab-lancamento-oleo').scrollIntoView({ behavior: 'smooth' });
    }));
    wrap.querySelectorAll('.del-oleo').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmModal('Excluir este lançamento de lubrificante?'))) return;
      try {
        const res = await apiFetch('/lancamentos-oleo?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
        if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao excluir lançamento de lubrificante'), true); return; }
        await renderEntriesOleo();
        showToast('Lançamento de lubrificante excluído.');
      } catch (e) { if (e.message !== 'unauthorized') showToast('Erro ao excluir.', true); }
    }));
  } catch (e) {
    if (e.message !== 'unauthorized') {
      // mesmo sem conseguir carregar do servidor (ex.: sem internet),
      // mostra os pendentes guardados no aparelho para a pessoa ver
      // que o lançamento dela não sumiu.
      const pendHtml = pendingOleoHtml();
      wrap.innerHTML = pendHtml + `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar lançamentos de lubrificante.')}</div>`;
    }
  }
}

// ---- Estoque e Entrada de Lubrificante ----
async function renderEstoqueOleo() {
  const wrap = document.getElementById('estoqueOleoCards');
  try {
    const res = await apiFetch('/estoque-oleo');
    const list = await readJsonListOrThrow(res, 'estoque de lubrificante');
    if (list.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Nenhum tipo de lubrificante cadastrado.</div>';
      return;
    }
    wrap.innerHTML = list.map((t) => `
      <div class="estoque-card ${t.abaixoDoMinimo ? 'low' : ''}">
        <div>
          <div class="nome">${escapeHtml(t.nome)}</div>
          <div class="detalhe">Entradas: ${fmtNum(t.totalEntradas)} L · Saídas: ${fmtNum(t.totalSaidas)} L</div>
          ${t.abaixoDoMinimo ? `<div class="alerta">Abaixo do mínimo (${fmtNum(t.estoqueMinimo)} L)</div>` : ''}
        </div>
        <div class="saldo">${fmtNum(t.saldoAtual)} L</div>
      </div>`).join('');
  } catch (e) {
    if (e.message !== 'unauthorized') wrap.innerHTML = `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar estoque de lubrificante.')}</div>`;
  }
}

function buildFiltroEntradasOleoParams() {
  const params = new URLSearchParams();
  const de = document.getElementById('eno_de') ? document.getElementById('eno_de').value : '';
  const ate = document.getElementById('eno_ate') ? document.getElementById('eno_ate').value : '';
  const tipo = document.getElementById('eno_tipo') ? document.getElementById('eno_tipo').value : '';
  if (de) params.set('de', de);
  if (ate) params.set('ate', ate);
  if (tipo) params.set('tipo_oleo_id', tipo);
  return params;
}

async function renderReportEntradasOleo() {
  const wrap = document.getElementById('reportEntradasOleoTableWrap');
  const pending = getPending().filter((p) => p.tipo === 'entrada_oleo');
  const pendHtml = pending.map((p) => {
    const tipo = tiposOleo.find((t) => t.id === p.payload.tipo_oleo_id);
    return `<div class="pending-item">
      ⏳ Pendente: ${fmtDateBR(p.payload.data)} · ${escapeHtml(tipo ? tipo.nome : 'lubrificante')} · ${fmtNum(p.payload.litros)} L
      ${p.lastError ? `<div style="color:var(--danger);margin-top:4px;">⚠ ${escapeHtml(p.lastError)}</div>` : ''}
    </div>`;
  }).join('');
  try {
    const params = buildFiltroEntradasOleoParams();
    const qs = params.toString();
    const res = await apiFetch('/entradas-oleo' + (qs ? '?' + qs : ''));
    const list = await readJsonListOrThrow(res, 'relatório de entradas de lubrificante');

    document.getElementById('statEntradasOleoCount').textContent = list.length + pending.length;
    const totalLitros = list.reduce((s, e) => s + (Number(e.litros) || 0), 0) + pending.reduce((s, p) => s + (Number(p.payload.litros) || 0), 0);
    document.getElementById('statEntradasOleoLitros').textContent = totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

    if (list.length === 0 && !pendHtml) {
      wrap.innerHTML = '<div class="empty-state"><span class="em-icon">📄</span>Nenhuma entrada de lubrificante encontrada para este filtro.</div>';
      return;
    }

    const s = getSession();
    const canDelete = isGerente(s);
    wrap.innerHTML = pendHtml + `
      <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Data</th><th>Tipo de Lubrificante</th><th>Litros</th><th>Fornecedor</th><th>Nota Fiscal</th><th>Observação</th>${canDelete ? '<th></th>' : ''}
        </tr></thead>
        <tbody>
          ${list.map((e) => `
            <tr>
              <td>${fmtDateBR(e.data)}</td>
              <td>${escapeHtml(e.tipos_oleo ? e.tipos_oleo.nome : '—')}</td>
              <td>${fmtNum(e.litros)}</td>
              <td>${escapeHtml(e.fornecedor || '—')}</td>
              <td>${escapeHtml(e.nota_fiscal || '—')}</td>
              <td>${escapeHtml(e.observacao || '—')}</td>
              ${canDelete ? `<td><button class="del" data-id="${e.id}">Remover</button></td>` : ''}
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="2">Total</td><td>${totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L</td><td colspan="${canDelete ? 4 : 3}"></td></tr></tfoot>
      </table>
      </div>`;
    if (canDelete) {
      wrap.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmModal('Remover esta entrada de lubrificante?'))) return;
        try {
          const res = await apiFetch('/entradas-oleo?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
          if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao remover entrada de lubrificante'), true); return; }
          await renderReportEntradasOleo();
          renderEstoqueOleo();
          showToast('Entrada removida.');
        } catch (e) { if (e.message !== 'unauthorized') showToast('Erro ao remover.', true); }
      }));
    }
  } catch (e) {
    if (e.message !== 'unauthorized') {
      wrap.innerHTML = pendHtml + `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar relatório.')}</div>`;
      document.getElementById('statEntradasOleoCount').textContent = '—';
      document.getElementById('statEntradasOleoLitros').textContent = '—';
    }
  }
}

const btnFiltrarEntradasOleo = document.getElementById('btnFiltrarEntradasOleo');
if (btnFiltrarEntradasOleo) btnFiltrarEntradasOleo.addEventListener('click', renderReportEntradasOleo);

const btnExportarEntradasOleo = document.getElementById('btnExportarEntradasOleo');
if (btnExportarEntradasOleo) {
  btnExportarEntradasOleo.addEventListener('click', async () => {
    try {
      const params = buildFiltroEntradasOleoParams();
      const res = await apiFetch('/export-entradas-oleo?' + params.toString());
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao gerar o Excel.'), true); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFromResponse(res, 'entradas-estoque-oleo.xlsx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Relatório de entradas de lubrificante baixado.');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Erro ao exportar.', true);
    }
  });
}

const btnSalvarEntradaOleo = document.getElementById('btnSalvarEntradaOleo');
if (btnSalvarEntradaOleo) {
  btnSalvarEntradaOleo.addEventListener('click', async () => {
    const payload = {
      data: document.getElementById('eo_data').value,
      tipo_oleo_id: document.getElementById('eo_tipo').value,
      litros: document.getElementById('eo_litros').value,
      fornecedor: document.getElementById('eo_fornecedor').value.trim(),
      nota_fiscal: document.getElementById('eo_notaFiscal').value.trim(),
      observacao: document.getElementById('eo_obs').value.trim()
    };
    if (!payload.data) { showToast('Informe a data.', true); return; }
    if (!payload.tipo_oleo_id) { showToast('Selecione o tipo de lubrificante.', true); return; }
    if (!payload.litros || Number(payload.litros) <= 0) { showToast('Informe a quantidade recebida (maior que zero).', true); return; }
    payload.client_ref = newClientRef();
    try {
      const res = await apiFetch('/entradas-oleo', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao registrar entrada de lubrificante'), true); return; }
      document.getElementById('eo_data').value = todayISO();
      document.getElementById('eo_litros').value = '';
      document.getElementById('eo_fornecedor').value = '';
      document.getElementById('eo_notaFiscal').value = '';
      document.getElementById('eo_obs').value = '';
      await renderReportEntradasOleo();
      renderEstoqueOleo();
      showToast('Entrada de lubrificante registrada.');
    } catch (e) {
      if (e.message === 'unauthorized') return;
      // sem rede ou conexão instável: guarda na fila offline, igual ao lançamento
      enqueuePending(payload, 'entrada_oleo');
      document.getElementById('eo_data').value = todayISO();
      document.getElementById('eo_litros').value = '';
      document.getElementById('eo_fornecedor').value = '';
      document.getElementById('eo_notaFiscal').value = '';
      document.getElementById('eo_obs').value = '';
      await renderReportEntradasOleo();
      showToast('Sem conexão — entrada de lubrificante guardada neste aparelho e será enviada quando a internet voltar.', true);
    }
  });
}

let relatorioOleoMode = 'periodo';

function buildFiltroParamsOleo() {
  const params = new URLSearchParams();
  if (relatorioOleoMode === 'dia') {
    const dia = document.getElementById('ro_dia').value;
    if (dia) { params.set('de', dia); params.set('ate', dia); }
  } else {
    const de = document.getElementById('ro_de').value;
    const ate = document.getElementById('ro_ate').value;
    if (de) params.set('de', de);
    if (ate) params.set('ate', ate);
  }
  const obraId = document.getElementById('ro_obra').value;
  const eqId = document.getElementById('ro_equipamento').value;
  const tipoId = document.getElementById('ro_tipo').value;
  const operador = document.getElementById('ro_operador').value.trim();
  if (obraId) params.set('obra_id', obraId);
  if (eqId) params.set('equipamento_id', eqId);
  if (tipoId) params.set('tipo_oleo_id', tipoId);
  if (operador) params.set('operador', operador);
  return params;
}

async function renderReportOleo() {
  const wrap = document.getElementById('reportTableWrapOleo');
  try {
    const params = buildFiltroParamsOleo();
    const res = await apiFetch('/lancamentos-oleo?' + params.toString());
    const list = await readJsonListOrThrow(res, 'relatório de lubrificante');

    document.getElementById('statCountOleo').textContent = list.length;
    const totalLitros = list.reduce((s, l) => s + (Number(l.litros) || 0), 0);
    document.getElementById('statLitrosOleo').textContent = totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

    if (list.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><span class="em-icon">📄</span>Nenhum lançamento de lubrificante encontrado para este filtro.</div>';
      return;
    }

    const sorted = relatorioOleoMode === 'dia' ? [...list].sort((a, b) => nomeEquipOleo(a).localeCompare(nomeEquipOleo(b))) : list;

    wrap.innerHTML = `
      <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Data</th><th>Hora</th><th>Obra</th><th>Equipamento</th><th>Tipo de Lubrificante</th><th>Operador</th><th>Litros</th>
        </tr></thead>
        <tbody>
          ${sorted.map((l) => `
            <tr>
              <td>${fmtDateBR(l.data)}</td>
              <td>${escapeHtml(l.hora || '—')}</td>
              <td>${escapeHtml(nomeObraOleo(l))}</td>
              <td>${escapeHtml(nomeEquipOleo(l))}</td>
              <td>${escapeHtml(nomeTipoOleo(l))}</td>
              <td>${escapeHtml(l.operador)}</td>
              <td>${fmtNum(l.litros)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="6">Total</td><td>${totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L</td></tr></tfoot>
      </table>
      </div>`;
  } catch (e) {
    if (e.message !== 'unauthorized') {
      wrap.innerHTML = `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar relatório.')}</div>`;
      document.getElementById('statCountOleo').textContent = '—';
      document.getElementById('statLitrosOleo').textContent = '—';
    }
  }
}

document.querySelectorAll('.mode-btn[data-modeoleo]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn[data-modeoleo]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    relatorioOleoMode = btn.dataset.modeoleo;
    document.getElementById('periodoFieldsOleo').classList.toggle('hidden', relatorioOleoMode !== 'periodo');
    document.getElementById('diaFieldsOleo').classList.toggle('hidden', relatorioOleoMode !== 'dia');
    if (relatorioOleoMode === 'dia' && !document.getElementById('ro_dia').value) {
      document.getElementById('ro_dia').value = todayISO();
    }
    renderReportOleo();
  });
});
const btnFiltrarOleo = document.getElementById('btnFiltrarOleo');
if (btnFiltrarOleo) btnFiltrarOleo.addEventListener('click', renderReportOleo);

const btnExportarLancamentosOleo = document.getElementById('btnExportarLancamentosOleo');
if (btnExportarLancamentosOleo) {
  btnExportarLancamentosOleo.addEventListener('click', async () => {
    try {
      const params = buildFiltroParamsOleo();
      const res = await apiFetch('/export-lancamentos-oleo?' + params.toString());
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao gerar o Excel.'), true); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFromResponse(res, 'relatorio-oleo.xlsx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Relatório de lançamentos de lubrificante baixado.');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Erro ao exportar.', true);
    }
  });
}

/* ================= Relatório ================= */
document.querySelectorAll('.mode-btn[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn[data-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    relatorioMode = btn.dataset.mode;
    document.getElementById('periodoFields').classList.toggle('hidden', relatorioMode !== 'periodo');
    document.getElementById('diaFields').classList.toggle('hidden', relatorioMode !== 'dia');
    if (relatorioMode === 'dia' && !document.getElementById('r_dia').value) {
      document.getElementById('r_dia').value = todayISO();
    }
    renderReport();
  });
});
document.getElementById('btnFiltrar').addEventListener('click', renderReport);

function buildFiltroParams() {
  const params = new URLSearchParams();
  if (relatorioMode === 'dia') {
    const dia = document.getElementById('r_dia').value;
    if (dia) { params.set('de', dia); params.set('ate', dia); }
  } else {
    const de = document.getElementById('r_de').value;
    const ate = document.getElementById('r_ate').value;
    if (de) params.set('de', de);
    if (ate) params.set('ate', ate);
  }
  const obraId = document.getElementById('r_obra').value;
  const eqId = document.getElementById('r_equipamento').value;
  const tcId = document.getElementById('r_tipoCombustivel').value;
  const operador = document.getElementById('r_operador').value.trim();
  if (obraId) params.set('obra_id', obraId);
  if (eqId) params.set('equipamento_id', eqId);
  if (tcId) params.set('tipo_combustivel_id', tcId);
  if (operador) params.set('operador', operador);
  return params;
}

async function renderReport() {
  const wrap = document.getElementById('reportTableWrap');
  try {
    const params = buildFiltroParams();
    const res = await apiFetch('/lancamentos?' + params.toString());
    const list = await readJsonListOrThrow(res, 'relatório');

    document.getElementById('statCount').textContent = list.length;
    const totalLitros = list.reduce((s, l) => s + (Number(l.litros) || 0), 0);
    document.getElementById('statLitros').textContent = totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

    if (list.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><span class="em-icon">📄</span>Nenhum lançamento encontrado para este filtro.</div>';
      return;
    }

    const sorted = relatorioMode === 'dia' ? [...list].sort((a, b) => nomeEquip(a).localeCompare(nomeEquip(b))) : list;

    wrap.innerHTML = `
      <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Data</th><th>Hora</th><th>Obra</th><th>Equipamento</th><th>Combustível</th><th>Operador</th>
          <th>Marc. Inicial</th><th>Marc. Final</th><th>Litros Saída</th><th>Km/Hora</th>
        </tr></thead>
        <tbody>
          ${sorted.map((l) => `
            <tr>
              <td>${fmtDateBR(l.data)}</td>
              <td>${escapeHtml(l.hora || '—')}</td>
              <td>${escapeHtml(nomeObra(l))}</td>
              <td>${escapeHtml(nomeEquip(l))}</td>
              <td>${escapeHtml(nomeTipo(l))}</td>
              <td>${escapeHtml(l.operador)}</td>
              <td><span class="odo">${l.marcador_inicial != null ? fmtNum(l.marcador_inicial) : '—'}</span></td>
              <td><span class="odo">${l.marcador_final != null ? fmtNum(l.marcador_final) : '—'}</span></td>
              <td>${fmtNum(l.litros)}</td>
              <td>${fmtNum(l.km_hora)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="8">Total</td><td>${totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L</td><td></td></tr></tfoot>
      </table>
      </div>`;
  } catch (e) {
    if (e.message !== 'unauthorized') {
      wrap.innerHTML = `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar relatório.')}</div>`;
      document.getElementById('statCount').textContent = '—';
      document.getElementById('statLitros').textContent = '—';
    }
  }
}

document.getElementById('btnExportar').addEventListener('click', async () => {
  try {
    const params = buildFiltroParams();
    const res = await apiFetch('/export?' + params.toString());
    if (!res.ok) { showToast('Erro ao gerar o Excel.', true); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filenameFromResponse(res, 'relatorio-combustivel.xlsx');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Relatório baixado.');
  } catch (e) {
    if (e.message !== 'unauthorized') showToast('Erro ao exportar.', true);
  }
});

/* ================= Dashboard ================= */
document.querySelectorAll('.mode-btn[data-dmode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn[data-dmode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    dashMode = btn.dataset.dmode;
    document.getElementById('dashDateLabel').textContent = dashMode === 'dia' ? 'Dia de referência' : 'Mês de referência (qualquer dia do mês)';
    document.getElementById('dashTotalLabel').textContent = dashMode === 'dia' ? 'Litros no dia' : 'Litros no mês';
    renderDashboard();
  });
});
document.getElementById('d_data').addEventListener('change', renderDashboard);

function renderBarList(container, items, labelKey, valueKey) {
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhum lançamento neste período.</div>';
    return;
  }
  const max = Math.max(...items.map((i) => i[valueKey]));
  container.innerHTML = items.map((i) => `
    <div class="bar-row">
      <div class="bar-label" title="${escapeHtml(i[labelKey])}">${escapeHtml(i[labelKey])}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${max > 0 ? (i[valueKey] / max) * 100 : 0}%"></div></div>
      <div class="bar-value">${fmtNum(i[valueKey])} L</div>
    </div>`).join('');
}

async function renderDashboard() {
  const dataRef = document.getElementById('d_data').value || todayISO();
  document.getElementById('d_data').value = dataRef;
  try {
    const res = await apiFetch(`/dashboard?periodo=${dashMode}&data=${dataRef}`);
    const info = await readJsonObjectOrThrow(res, 'dashboard');

    document.getElementById('dashTotalLitros').textContent = info.totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    document.getElementById('dashTotalLanc').textContent = info.totalLancamentos;
    document.getElementById('dashTotalEquip').textContent = info.porEquipamento.length;

    renderBarList(document.getElementById('dashBars'), info.porEquipamento.map((e) => ({ nome: e.nome, litros: e.litros })), 'nome', 'litros');
    renderBarList(document.getElementById('dashBarsTipo'), info.porTipoCombustivel.map((t) => ({ nome: t.nome, litros: t.litros })), 'nome', 'litros');
  } catch (e) {
    if (e.message !== 'unauthorized') {
      document.getElementById('dashTotalLitros').textContent = '—';
      document.getElementById('dashTotalLanc').textContent = '—';
      document.getElementById('dashTotalEquip').textContent = '—';
      document.getElementById('dashBars').innerHTML = `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar dashboard.')}</div>`;
      document.getElementById('dashBarsTipo').innerHTML = '';
    }
  }
}

/* ================= Usuários ================= */
async function renderUsuarios() {
  const wrap = document.getElementById('listaUsuarios');
  try {
    const res = await apiFetch('/users');
    const list = await readJsonListOrThrow(res, 'usuários');
    const s = getSession();
    wrap.innerHTML = list.map((u) => `
      <div class="list-item">
        <span class="name">${escapeHtml(u.nome)} <span class="role-tag" style="color:var(--muted)">· ${roleLabel(u.role)}</span></span>
        ${isAdmin(s) ? `<button class="del" data-id="${u.id}">Remover</button>` : ''}
      </div>`).join('');
    wrap.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmModal('Remover este usuário?'))) return;
      try {
        const res = await apiFetch('/users?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
        if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao remover usuário'), true); return; }
        await renderUsuarios();
        showToast('Usuário removido.');
      } catch (e) { if (e.message !== 'unauthorized') showToast('Erro ao remover.', true); }
    }));
  } catch (e) {
    if (e.message !== 'unauthorized') wrap.innerHTML = `<div class="empty-state">${escapeHtml(e.message || 'Erro ao carregar usuários.')}</div>`;
  }
}

const btnAddUsuario = document.getElementById('btnAddUsuario');
if (btnAddUsuario) {
  btnAddUsuario.addEventListener('click', async () => {
    const nome = document.getElementById('u_nome').value.trim();
    const email = document.getElementById('u_email').value.trim();
    const senha = document.getElementById('u_senha').value;
    const role = document.getElementById('u_role').value;
    if (!nome || !email || !senha) { showToast('Preencha nome, e-mail e senha.', true); return; }
    if (senha.length < 6) { showToast('A senha precisa ter ao menos 6 caracteres.', true); return; }
    try {
      const res = await apiFetch('/users', { method: 'POST', body: JSON.stringify({ nome, email, password: senha, role }) });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao criar usuário'), true); return; }
      document.getElementById('u_nome').value = '';
      document.getElementById('u_email').value = '';
      document.getElementById('u_senha').value = '';
      await renderUsuarios();
      showToast('Usuário criado.');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Erro ao criar usuário.', true);
    }
  });
}

/* ================= Configurações (admin) ================= */
async function carregarConfiguracoes() {
  const sel = document.getElementById('cfg_obraPadrao');
  if (!sel) return;
  try {
    const res = await apiFetch('/configuracoes');
    const cfg = await readJsonObjectOrThrow(res, 'configurações');
    if (cfg.obra_padrao_id) sel.value = cfg.obra_padrao_id;
  } catch (e) {
    if (e.message !== 'unauthorized') showToast('Erro ao carregar configurações.', true);
  }
}

const btnSalvarConfiguracoes = document.getElementById('btnSalvarConfiguracoes');
if (btnSalvarConfiguracoes) {
  btnSalvarConfiguracoes.addEventListener('click', async () => {
    const obraId = document.getElementById('cfg_obraPadrao').value;
    if (!obraId) { showToast('Selecione a obra padrão.', true); return; }
    try {
      const res = await apiFetch('/configuracoes', { method: 'PUT', body: JSON.stringify({ chave: 'obra_padrao_id', valor: obraId }) });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao salvar configurações'), true); return; }
      showToast('Configurações salvas.');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Erro ao salvar configurações.', true);
    }
  });
}

/* ================= PWA ================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline na primeira visita: ok */ });
  });
}

/* ================= Init ================= */
async function init() {
  const s = getSession();
  document.getElementById('r_de').value = todayISO();
  document.getElementById('r_ate').value = todayISO();
  document.getElementById('r_dia').value = todayISO();
  document.getElementById('ro_dia').value = todayISO();
  document.getElementById('d_data').value = todayISO();
  document.getElementById('e_data').value = todayISO();
  document.getElementById('eo_data').value = todayISO();
  updateOfflineBanner();
  updatePendingUI();
  await loadCadastros();

  if (s && s.role === 'operador') {
    // Tela simplificada: só o formulário de lançamento. O Operador não
    // tem acesso a listas, relatórios nem estoque, então nem busca esses
    // dados — evita chamadas de rede desnecessárias.
    resetOpForm();
    flushPending();
    return;
  }

  resetForm();
  resetFormOleo();
  await renderEntries();
  await renderEntriesOleo();
  if (isGerente(s)) {
    renderReport();
    renderReportOleo();
    renderReportEntradas();
    renderReportEntradasOleo();
    renderDashboard();
  }
  renderEstoque();
  renderEstoqueOleo();
  flushPending();
}

/* ================= Lançamento simplificado (papel "operador") ================= */
let opMode = 'diesel'; // 'diesel' | 'oleo'

function resetOpForm() {
  document.getElementById('op_data').value = todayISO();
  document.getElementById('op_operador').value = '';
  if (buscaEquipamentoOperador) buscaEquipamentoOperador.clear();
  document.getElementById('op_tipoOleo').value = '';
  document.getElementById('op_litros').value = '';
  document.getElementById('op_kmhora').value = '';
  document.getElementById('op_marcInicial').value = '';
  opMode = 'diesel';
  document.querySelectorAll('.mode-btn[data-opmode]').forEach((b) => b.classList.toggle('active', b.dataset.opmode === 'diesel'));
  const campoOleo = document.getElementById('op_campoTipoOleo');
  if (campoOleo) campoOleo.classList.add('hidden');
  const campoKmHora = document.getElementById('op_campoKmHora');
  if (campoKmHora) campoKmHora.classList.remove('hidden');
  const labelLitros = document.getElementById('op_labelLitros');
  if (labelLitros) labelLitros.textContent = 'Litros de Saída';
  autofillMarcadorInicialOperador();
}

// Igual ao autofillMarcadorInicial() do formulário completo, mas grava no
// campo oculto (o Operador não vê o marcador na tela — só continua sendo
// calculado por trás, automaticamente).
async function autofillMarcadorInicialOperador() {
  const campo = document.getElementById('op_marcInicial');
  if (!campo) return;
  try {
    const res = await apiFetch('/lancamentos');
    const list = await readJsonListOrThrow(res, 'histórico de lançamentos');
    if (list.length === 0) return;
    const ultimo = list[list.length - 1];
    if (ultimo.marcador_final != null) campo.value = ultimo.marcador_final;
  } catch (e) {
    // conveniência apenas: se falhar (ex.: sem internet), o lançamento
    // ainda assim é salvo normalmente, só sem o marcador dessa vez.
  }
}

document.querySelectorAll('.mode-btn[data-opmode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn[data-opmode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    opMode = btn.dataset.opmode;
    document.getElementById('op_campoTipoOleo').classList.toggle('hidden', opMode !== 'oleo');
    document.getElementById('op_campoKmHora').classList.toggle('hidden', opMode === 'oleo');
    document.getElementById('op_labelLitros').textContent = opMode === 'oleo' ? 'Quantidade' : 'Litros de Saída';
  });
});

// Janela de confirmação com o resumo do lançamento, antes de salvar de
// verdade — como o Operador não edita mais depois, essa conferência
// prévia é a única chance dele corrigir algo digitado errado.
function confirmarLancamentoOperador(resumoHtml) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('opConfirmOverlay');
    document.getElementById('opConfirmResumo').innerHTML = resumoHtml;
    overlay.classList.remove('hidden');
    const okBtn = document.getElementById('opConfirmOk');
    const cancelBtn = document.getElementById('opConfirmCancelar');
    const cleanup = (result) => {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlayClick = (e) => { if (e.target === overlay) cleanup(false); };
    const onKeydown = (e) => { if (e.key === 'Escape') cleanup(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);
  });
}

document.getElementById('op_btnSalvar').addEventListener('click', async () => {
  const data = document.getElementById('op_data').value;
  const operador = document.getElementById('op_operador').value.trim();
  const equipamentoId = document.getElementById('op_equipamento').value;
  const litros = document.getElementById('op_litros').value;
  const kmHora = document.getElementById('op_kmhora').value;

  if (!data) { showToast('Informe a data.', true); return; }
  if (!operador) { showToast('Informe o motorista.', true); return; }
  if (!equipamentoId) { showToast('Selecione o equipamento.', true); return; }
  if (litros === '' || Number(litros) <= 0) { showToast('Informe a quantidade (maior que zero).', true); return; }

  let tipoOleoId = '';
  if (opMode === 'oleo') {
    tipoOleoId = document.getElementById('op_tipoOleo').value;
    if (!tipoOleoId) { showToast('Selecione o tipo de lubrificante.', true); return; }
  }

  const equipamentoSelecionado = equipamentos.find((e) => e.id === equipamentoId);
  const tipoOleoOpt = document.getElementById('op_tipoOleo').selectedOptions[0];
  const equipTexto = equipamentoSelecionado ? numeroEquipamento(equipamentoSelecionado.nome) : '';
  const combustivelTexto = opMode === 'oleo' ? (tipoOleoOpt ? tipoOleoOpt.textContent : '') : 'Diesel';

  const resumo = `
    <div><b>Data:</b> ${escapeHtml(fmtDateBR(data))}</div>
    <div><b>Motorista:</b> ${escapeHtml(operador)}</div>
    <div><b>Equipamento:</b> ${escapeHtml(equipTexto)}</div>
    <div><b>${opMode === 'oleo' ? 'Lubrificante' : 'Combustível'}:</b> ${escapeHtml(combustivelTexto)}</div>
    <div><b>${opMode === 'oleo' ? 'Quantidade' : 'Litros de Saída'}:</b> ${escapeHtml(fmtNum(litros))} L</div>
    ${opMode !== 'oleo' && kmHora !== '' ? `<div><b>Km/Hora:</b> ${escapeHtml(fmtNum(kmHora))}</div>` : ''}
  `;

  const confirmou = await confirmarLancamentoOperador(resumo);
  if (!confirmou) return;

  const hora = horaAgora();
  const clientRef = newClientRef();

  if (opMode === 'oleo') {
    const payload = {
      data, hora, operador, equipamento_id: equipamentoId,
      tipo_oleo_id: tipoOleoId, litros, client_ref: clientRef
    };
    try {
      const res = await apiFetch('/lancamentos-oleo', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao salvar lançamento'), true); return; }
      showToast('Lançamento salvo.');
      resetOpForm();
    } catch (e) {
      if (e.message === 'unauthorized') return;
      enqueuePending(payload, 'oleo');
      showToast('Sem conexão — lançamento guardado neste aparelho e será enviado quando a internet voltar.', true);
      resetOpForm();
    }
    return;
  }

  // Diesel é fixo — descobre o id dele na lista de combustíveis cadastrados
  // (normalmente só existe um, já que a empresa só usa Diesel).
  const diesel = tiposCombustivel.find((t) => (t.nome || '').toLowerCase().includes('diesel')) || tiposCombustivel[0];
  if (!diesel) { showToast('Nenhum combustível cadastrado. Avise o administrador.', true); return; }

  const payload = {
    data, hora, operador, equipamento_id: equipamentoId,
    tipo_combustivel_id: diesel.id,
    marcador_inicial: document.getElementById('op_marcInicial').value,
    litros, km_hora: kmHora, client_ref: clientRef
  };
  try {
    const res = await apiFetch('/lancamentos', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) { showToast(await serverErrorMessage(res, 'Erro ao salvar lançamento'), true); return; }
    showToast('Lançamento salvo.');
    resetOpForm();
  } catch (e) {
    if (e.message === 'unauthorized') return;
    enqueuePending(payload, 'combustivel');
    showToast('Sem conexão — lançamento guardado neste aparelho e será enviado quando a internet voltar.', true);
    resetOpForm();
  }
});

boot();
