import { apiGet, apiPost, apiPut, getToken, setToken, clearToken } from './api.js';
import { state } from './state.js';
import { startRouter } from './router.js';
import { toast, openModal, esc } from './ui.js';

const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');

function showLogin() {
  app.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  const user = document.getElementById('login-user');
  if (user) user.focus();
}

function showApp() {
  loginScreen.classList.add('hidden');
  app.classList.remove('hidden');
  document.getElementById('topbar-user').textContent = state.user ? state.user.name || state.user.username : '';
  refreshRateChip();
  startRouter();
}

async function refreshRateChip() {
  try {
    state.exchangeRate = await apiGet('/api/exchange-rate');
  } catch {
    /* mantiene el valor por defecto */
  }
  const chip = document.getElementById('rate-chip');
  chip.textContent = `USD$ 1 = RD$ ${state.exchangeRate.rate}`;
}

// Chip de tasa: actualizar desde BCRD o fijar manual
document.getElementById('rate-chip').addEventListener('click', () => {
  const m = openModal(`
    <h2>Tasa de cambio USD$ → RD$</h2>
    <p class="muted small">Fuente actual: ${esc(state.exchangeRate.source)} — RD$ ${esc(state.exchangeRate.rate)}</p>
    <label>Tasa manual
      <input type="number" step="0.01" min="1" id="rate-input" value="${esc(state.exchangeRate.rate)}">
    </label>
    <div class="modal-actions">
      <button class="btn" data-act="bcrd">↻ Buscar en BCRD</button>
      <button class="btn btn-primary" data-act="save">Guardar manual</button>
    </div>
  `);
  m.el.querySelector('[data-act="save"]').onclick = async () => {
    const rate = Number(m.el.querySelector('#rate-input').value);
    if (!rate || rate <= 0) return toast('Tasa inválida', 'error');
    try {
      state.exchangeRate = await apiPut('/api/exchange-rate', { rate });
      m.close();
      refreshRateChip();
      toast('Tasa actualizada', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  m.el.querySelector('[data-act="bcrd"]').onclick = async () => {
    try {
      const r = await apiPost('/api/exchange-rate/refresh');
      state.exchangeRate = r;
      refreshRateChip();
      if (r.fetchError) toast('BCRD no disponible — se mantiene la tasa guardada', 'error');
      else {
        m.close();
        toast(`Tasa BCRD: RD$ ${r.rate}`, 'success');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };
});

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  try {
    const data = await apiPost('/api/auth/login', {
      username: document.getElementById('login-user').value.trim(),
      password: document.getElementById('login-pass').value
    });
    setToken(data.token);
    state.user = data.user;
    document.getElementById('login-pass').value = '';
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

// Logout: limpiar token PRIMERO (principio lockApp del documento)
document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken();
  state.user = null;
  location.hash = '';
  showLogin();
});

window.addEventListener('cf:unauthorized', () => {
  state.user = null;
  showLogin();
});

// Auto-restore de sesión al refrescar (tryRestoreSession del documento)
(async function tryRestoreSession() {
  if (!getToken()) return showLogin();
  try {
    const data = await apiGet('/api/auth/me');
    state.user = data.user;
    showApp();
  } catch {
    showLogin();
  }
})();
