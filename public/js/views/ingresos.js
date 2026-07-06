import { apiGet, apiPost, apiDelete } from '../api.js';
import { esc, toast, confirmDialog } from '../ui.js';
import { fmtRD, fmtMoney, fmtFechaDDMM, todayISO, currentMonthKey, quincenaOf } from '../format.js';
import { monthNavHTML, bindMonthNav } from '../monthnav.js';

let month = null;

export async function render(el) {
  if (!month) month = currentMonthKey();
  const [txs, fijos] = await Promise.all([
    apiGet(`/api/transactions?month=${month}&kind=ingreso`),
    apiGet(`/api/fixed-incomes?month=${month}`)
  ]);
  const total = txs.reduce((a, t) => a + (t.moneda === 'USD$' ? 0 : t.montoNum), 0);

  el.innerHTML = `
    <div class="section-head">
      <h1>Ingresos</h1>
      ${monthNavHTML(month)}
    </div>

    <div class="card">
      <h2>Registrar ingreso</h2>
      <form id="income-form" class="form-grid">
        <label class="full">Descripción
          <input type="text" name="nombre" required placeholder="Ej. Quincena, freelance…">
        </label>
        <label>Monto
          <input type="number" name="montoNum" step="0.01" min="0.01" required>
        </label>
        <label>Moneda
          <select name="moneda"><option>RD$</option><option>USD$</option></select>
        </label>
        <label>Fuente
          <input type="text" name="fuente" placeholder="Salario, negocio…">
        </label>
        <label>Cuenta
          <input type="text" name="cuenta" placeholder="BHD, Popular…">
        </label>
        <label>Fecha
          <input type="date" name="fechaSort" value="${todayISO()}" required>
        </label>
        <label>Quincena
          <select name="quincena">
            <option value="">Auto (según fecha)</option>
            <option value="1">Q1 (1–15)</option>
            <option value="2">Q2 (16–fin)</option>
          </select>
        </label>
        <button type="submit" class="btn btn-primary">＋ Agregar</button>
      </form>
    </div>

    <div class="split-2">
      <div class="card">
        <h2>Ingresos del mes <span class="muted small">· total ${fmtRD(total)}</span></h2>
        ${txs.length === 0 ? '<p class="empty-state">Sin ingresos este mes</p>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Fuente</th><th>Q</th><th class="right">Monto</th><th></th></tr></thead>
          <tbody>
            ${txs.map((t) => `
              <tr>
                <td class="muted">${fmtFechaDDMM(t.fechaSort)}</td>
                <td>${esc(t.nombre)}</td>
                <td class="muted">${esc(t.fuente || '')}</td>
                <td><span class="badge badge-q${t.quincena || quincenaOf(t.fechaSort)}">Q${t.quincena || quincenaOf(t.fechaSort)}</span></td>
                <td class="right pos">+${fmtMoney(t.montoNum, t.moneda)}</td>
                <td><button class="btn btn-sm btn-ghost" data-del-tx="${t.id}" title="Eliminar">🗑</button></td>
              </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>

      <div class="card">
        <h2>Ingresos fijos recurrentes</h2>
        <form id="fixed-income-form" class="form-grid">
          <label>Descripción<input type="text" name="descripcion" required placeholder="Salario Q1"></label>
          <label>Monto RD$<input type="number" name="monto" step="0.01" min="0.01" required></label>
          <label>Día del mes<input type="number" name="dia" min="1" max="31" required></label>
          <label>Cuenta<input type="text" name="cuenta"></label>
          <button type="submit" class="btn btn-primary">＋</button>
        </form>
        ${fijos.length === 0 ? '<p class="empty-state">Sin ingresos fijos</p>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>Día</th><th>Descripción</th><th class="right">Monto</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${fijos.map((f) => `
              <tr>
                <td>${f.dia} <span class="badge badge-q${f.quincena}">Q${f.quincena}</span></td>
                <td>${esc(f.descripcion)}${f.activo ? '' : ' <span class="badge badge-muted">inactivo</span>'}</td>
                <td class="right">${fmtRD(f.monto)}</td>
                <td>${f.recibido
                  ? '<span class="badge badge-ok">recibido</span>'
                  : `<button class="btn btn-sm btn-success" data-receive="${f.id}">Marcar recibido</button>`}</td>
                <td><button class="btn btn-sm btn-ghost" data-del-fixed="${f.id}" title="Eliminar">🗑</button></td>
              </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    </div>
  `;

  bindMonthNav(el, month, (nuevo) => { month = nuevo; render(el); });

  el.querySelector('#income-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await apiPost('/api/transactions', {
        nombre: f.get('nombre'),
        montoNum: Number(f.get('montoNum')),
        moneda: f.get('moneda'),
        fuente: f.get('fuente') || undefined,
        cuenta: f.get('cuenta') || undefined,
        fechaSort: f.get('fechaSort'),
        quincena: f.get('quincena') ? Number(f.get('quincena')) : undefined,
        neg: false
      });
      toast('Ingreso registrado', 'success');
      render(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  el.querySelector('#fixed-income-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await apiPost('/api/fixed-incomes', {
        descripcion: f.get('descripcion'),
        monto: Number(f.get('monto')),
        dia: Number(f.get('dia')),
        cuenta: f.get('cuenta') || undefined
      });
      toast('Ingreso fijo creado', 'success');
      render(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  el.querySelectorAll('[data-receive]').forEach((b) => {
    b.onclick = async () => {
      try {
        await apiPost(`/api/fixed-incomes/${b.dataset.receive}/receive`, { month });
        toast('Ingreso marcado como recibido', 'success');
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  el.querySelectorAll('[data-del-tx]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('¿Eliminar este ingreso?', { danger: true, okLabel: 'Eliminar' })) return;
      try {
        await apiDelete(`/api/transactions/${b.dataset.delTx}`);
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  el.querySelectorAll('[data-del-fixed]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('¿Eliminar este ingreso fijo?', { danger: true, okLabel: 'Eliminar' })) return;
      try {
        await apiDelete(`/api/fixed-incomes/${b.dataset.delFixed}`);
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}
