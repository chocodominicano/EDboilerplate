// Utilidades de UI: escape HTML, modales, confirmación, toasts, barras.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function openModal(html) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">${html}</div>`;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  root.appendChild(backdrop);
  return {
    el: backdrop.firstElementChild,
    close: () => backdrop.remove()
  };
}

export function confirmDialog(message, { danger = false, okLabel = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    const m = openModal(`
      <p>${message}</p>
      <div class="modal-actions">
        <button class="btn" data-act="cancel">Cancelar</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(okLabel)}</button>
      </div>
    `);
    m.el.querySelector('[data-act="cancel"]').onclick = () => { m.close(); resolve(false); };
    m.el.querySelector('[data-act="ok"]').onclick = () => { m.close(); resolve(true); };
  });
}

export function toast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  root.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

// Barra de uso: permite >100% (hasta 115% visual) con clase 'over'
export function progressBar(pct) {
  const width = Math.max(0, Math.min(Number(pct) || 0, 115));
  const cls = pct > 100 ? 'over' : (pct > 80 ? 'warn' : '');
  return `<div class="progress"><i class="${cls}" style="width:${width}%"></i></div>`;
}

export function overLimitBadge(pct) {
  return pct > 100 ? '<span class="badge badge-danger">⚠ Límite superado</span>' : '';
}
