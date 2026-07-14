import * as dashboard from './views/dashboard.js';
import * as ingresos from './views/ingresos.js';
import * as gastos from './views/gastos.js';
import * as tarjetas from './views/tarjetas.js';
import * as prestamos from './views/prestamos.js';
import * as metas from './views/metas.js';
import * as presupuesto from './views/presupuesto.js';
import * as radar from './views/radar.js';
import * as admin from './views/admin.js';

const views = { dashboard, ingresos, gastos, tarjetas, prestamos, metas, presupuesto, radar, admin };

export function navigate(name) {
  location.hash = `#/${name}`;
}

async function render() {
  const name = (location.hash || '#/dashboard').replace(/^#\//, '') || 'dashboard';
  const view = views[name] || views.dashboard;

  document.querySelectorAll('#main-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name || (!views[name] && a.dataset.route === 'dashboard'));
  });

  const el = document.getElementById('view');
  el.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    await view.render(el);
  } catch (err) {
    if (err.message !== 'Sesión expirada') {
      el.innerHTML = `<div class="card"><p class="neg">Error: ${err.message}</p></div>`;
    }
  }
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/dashboard';
  render();
}
