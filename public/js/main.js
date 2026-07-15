import { apiGet, apiPost, apiPut, getToken, setToken, clearToken } from './api.js';
import { state } from './state.js';
import { startRouter } from './router.js';
import { toast, openModal, esc } from './ui.js';

const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

let pillId = null; // usuario elegido desde una pill (login sin escribir usuario)

function showLogin() {
  app.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  buildUserPills();
  document.getElementById('login-user').focus();
}

function showApp() {
  loginScreen.classList.add('hidden');
  app.classList.remove('hidden');
  document.getElementById('topbar-user').textContent = state.user ? state.user.name || state.user.username : '';
  // Visible para todos: los usuarios ven Mi perfil y catálogos;
  // la gestión de usuarios y logs se filtra por rol dentro de la vista
  document.getElementById('nav-admin').classList.remove('hidden');
  refreshRateChip();
  startRouter();
}

// ─── Pills de usuarios activos ─────────────────────────────

async function buildUserPills() {
  const box = document.getElementById('user-pills');
  try {
    const pills = await apiGet('/api/auth/pills');
    box.innerHTML = pills.map((p) => `
      <button type="button" class="auth-av-pill" data-pill="${p.id}" data-name="${esc(p.name)}" title="${esc(p.name)}">
        <span class="auth-av-circle">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : esc(p.initials)}</span>
        <span class="auth-av-name">${esc(p.name.split(' ')[0])}</span>
      </button>`).join('');
    box.querySelectorAll('[data-pill]').forEach((b) => {
      b.onclick = () => selectUserPill(Number(b.dataset.pill), b.dataset.name);
    });
  } catch {
    box.innerHTML = '';
  }
}

function selectUserPill(id, name) {
  pillId = id;
  document.querySelectorAll('.auth-av-pill').forEach((p) => {
    p.classList.toggle('selected', Number(p.dataset.pill) === id);
  });
  document.getElementById('login-user-label').classList.add('hidden');
  document.getElementById('pill-selected-name').textContent = name;
  document.getElementById('pill-selected').classList.remove('hidden');
  document.getElementById('login-pass').focus();
}

function clearPillSelection() {
  pillId = null;
  document.querySelectorAll('.auth-av-pill').forEach((p) => p.classList.remove('selected'));
  document.getElementById('login-user-label').classList.remove('hidden');
  document.getElementById('pill-selected').classList.add('hidden');
}

document.getElementById('pill-clear').addEventListener('click', (e) => {
  e.preventDefault();
  clearPillSelection();
  document.getElementById('login-user').focus();
});

// ─── Toggle de visibilidad de contraseña (login y registro) ─

document.querySelectorAll('[data-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.toggle);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁';
  });
});

// ─── Navegación con Enter (usuario → contraseña → submit) ──

document.getElementById('login-user').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('login-pass').focus();
  }
});

// ─── Tasa de cambio ────────────────────────────────────────

async function refreshRateChip() {
  try {
    state.exchangeRate = await apiGet('/api/exchange-rate');
  } catch {
    /* mantiene el valor por defecto */
  }
  const chip = document.getElementById('rate-chip');
  chip.textContent = `USD$ 1 = RD$ ${state.exchangeRate.rate}`;
}

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

// ─── Login ─────────────────────────────────────────────────

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.classList.add('hidden');

  const payload = { password: document.getElementById('login-pass').value };
  if (pillId) payload.pillId = pillId;
  else payload.username = document.getElementById('login-user').value.trim();

  btn.disabled = true;
  btn.textContent = 'Verificando…';
  try {
    const data = await apiPost('/api/auth/login', payload);
    setToken(data.token);
    state.user = data.user;
    document.getElementById('login-pass').value = '';
    clearPillSelection();
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar →';
  }
});

// ─── Registro (queda pendiente de aprobación) ──────────────

let regAvatarData = null;
const regPreview = document.getElementById('reg-avatar-preview');

document.getElementById('reg-avatar').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 300 * 1024) {
    toast('La foto es muy grande (máximo 300KB)', 'error');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    regAvatarData = ev.target.result;
    const emoji = regPreview.querySelector('span:first-of-type');
    let img = regPreview.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      regPreview.insertBefore(img, regPreview.firstChild);
    }
    img.src = regAvatarData;
    if (emoji) emoji.style.display = 'none';
  };
  reader.readAsDataURL(file);
});

// Indicador en tiempo real de coincidencia de contraseñas
function checkPassMatch() {
  const p1 = document.getElementById('reg-pass').value;
  const p2 = document.getElementById('reg-pass2').value;
  const el = document.getElementById('reg-pass-match');
  if (!p2) return el.classList.add('hidden');
  el.classList.remove('hidden');
  const ok = p1 === p2;
  el.textContent = ok ? '✓ Las contraseñas coinciden' : '✗ Las contraseñas no coinciden';
  el.className = `auth-match ${ok ? 'ok' : 'bad'}`;
}
document.getElementById('reg-pass').addEventListener('input', checkPassMatch);
document.getElementById('reg-pass2').addEventListener('input', checkPassMatch);

document.getElementById('show-register').addEventListener('click', (e) => {
  e.preventDefault();
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  registerForm.classList.remove('auth-view');
  void registerForm.offsetWidth; // reinicia la animación de entrada
  registerForm.classList.add('auth-view');
  document.getElementById('reg-nombre').focus();
});

document.getElementById('show-login').addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  loginForm.classList.remove('auth-view');
  void loginForm.offsetWidth;
  loginForm.classList.add('auth-view');
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('register-error');
  const okEl = document.getElementById('register-ok');
  const btn = document.getElementById('register-btn');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');

  const pass = document.getElementById('reg-pass').value;
  if (pass !== document.getElementById('reg-pass2').value) {
    errEl.textContent = 'Las contraseñas no coinciden';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creando…';
  try {
    const data = await apiPost('/api/auth/register', {
      nombre: document.getElementById('reg-nombre').value.trim(),
      apellido: document.getElementById('reg-apellido').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      phone: document.getElementById('reg-phone').value.trim() || undefined,
      password: pass,
      avatar: regAvatarData || undefined
    });
    registerForm.reset();
    regAvatarData = null;
    const img = regPreview.querySelector('img');
    if (img) img.remove();
    const emoji = regPreview.querySelector('span:first-of-type');
    if (emoji) emoji.style.display = '';
    document.getElementById('reg-pass-match').classList.add('hidden');
    okEl.textContent = data.message;
    okEl.classList.remove('hidden');
    toast('Cuenta creada — pendiente de aprobación', 'success');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear cuenta →';
  }
});

// ─── Logout y restore ──────────────────────────────────────

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
