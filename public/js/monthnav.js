import { monthLabel, addMonthsToKey } from './format.js';

// Selector ‹ Mes Año › reutilizable. onChange(nuevoKey) re-renderiza la vista.
export function monthNavHTML(key) {
  return `
    <div class="month-nav">
      <button class="btn btn-sm" data-mn="prev">‹</button>
      <span class="label" data-mn="label">${monthLabel(key)}</span>
      <button class="btn btn-sm" data-mn="next">›</button>
    </div>
  `;
}

export function bindMonthNav(container, key, onChange) {
  container.querySelector('[data-mn="prev"]').onclick = () => onChange(addMonthsToKey(key, -1));
  container.querySelector('[data-mn="next"]').onclick = () => onChange(addMonthsToKey(key, 1));
}
