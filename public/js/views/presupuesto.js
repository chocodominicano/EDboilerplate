import { apiGet, apiPost, apiDelete } from '../api.js';
import { esc, toast, confirmDialog, progressBar } from '../ui.js';
import { fmtRD, currentMonthKey } from '../format.js';
import { monthNavHTML, bindMonthNav } from '../monthnav.js';

const CATEGORIAS = ['Comida', 'Transporte', 'Servicios', 'Salud', 'Entretenimiento',
  'Educación', 'Hogar', 'Ropa', 'Préstamos', 'Gastos fijos', 'Otros'];

let month = null;

export async function render(el) {
  if (!month) month = currentMonthKey();
  const budgets = await apiGet(`/api/budgets?month=${month}`);
  const totalPresupuesto = budgets.reduce((a, b) => a + b.monto, 0);
  const totalGastado = budgets.reduce((a, b) => a + b.gastado, 0);

  el.innerHTML = `
    <div class="section-head">
      <h1>Presupuesto por categoría</h1>
      ${monthNavHTML(month)}
    </div>

    <div class="card">
      <form id="budget-form" class="form-grid">
        <label>Categoría
          <select name="cat">${CATEGORIAS.map((c) => `<option>${c}</option>`).join('')}</select>
        </label>
        <label>Presupuesto mensual RD$
          <input type="number" name="monto" step="0.01" min="0.01" required>
        </label>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </form>
      <p class="muted small" style="margin-top:0.5rem">Si la categoría ya tiene presupuesto, se actualiza el monto.</p>
    </div>

    <div class="card">
      <h2>Progreso del mes
        <span class="muted small">· gastado ${fmtRD(totalGastado)} de ${fmtRD(totalPresupuesto)}</span>
      </h2>
      ${budgets.length === 0 ? '<p class="empty-state">Define presupuestos por categoría para controlar tu gasto mensual</p>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Categoría</th><th class="right">Presupuesto</th><th class="right">Gastado</th><th style="min-width:180px">Progreso</th><th></th></tr></thead>
        <tbody>
          ${budgets.map((b) => `
            <tr>
              <td>${esc(b.cat)}</td>
              <td class="right">${fmtRD(b.monto)}</td>
              <td class="right ${b.pct > 100 ? 'neg' : ''}">${fmtRD(b.gastado)}</td>
              <td>
                ${progressBar(b.pct)}
                <span class="small ${b.pct > 100 ? 'neg' : 'muted'}">${b.pct}%${b.pct > 100 ? ' — excedido' : ''}</span>
              </td>
              <td><button class="btn btn-sm btn-ghost" data-del="${b.id}" title="Eliminar">🗑</button></td>
            </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>
  `;

  bindMonthNav(el, month, (nuevo) => { month = nuevo; render(el); });

  el.querySelector('#budget-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await apiPost('/api/budgets', { cat: f.get('cat'), monto: Number(f.get('monto')) });
      toast('Presupuesto guardado', 'success');
      render(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  el.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('¿Eliminar este presupuesto?', { danger: true, okLabel: 'Eliminar' })) return;
      try {
        await apiDelete(`/api/budgets/${b.dataset.del}`);
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}
