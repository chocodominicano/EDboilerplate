import { apiGet, apiPost, apiPut, apiDelete } from '../api.js';
import { esc, toast, confirmDialog, openModal } from '../ui.js';
import { fmtRD, fmtMoney, fmtFechaDDMM, todayISO, currentMonthKey, quincenaOf } from '../format.js';
import { monthNavHTML, bindMonthNav } from '../monthnav.js';
import { attachMoney, moneyToNum, moneyStr } from '../money.js';

let month = null;
let filtroFuente = '';
let filtroQuincena = '';

export async function render(el) {
  if (!month) month = currentMonthKey();
  const [resumen, txs, fijos, catalog] = await Promise.all([
    apiGet(`/api/ingresos/resumen?month=${month}`),
    apiGet(`/api/transactions?month=${month}&kind=ingreso`),
    apiGet(`/api/fixed-incomes?month=${month}`),
    apiGet('/api/catalog').catch(() => ({ paymentMethods: [] }))
  ]);
  const cuentas = catalog.paymentMethods || [];

  el.innerHTML = `
    <div class="section-head">
      <h1>Ingresos</h1>
      ${monthNavHTML(month)}
    </div>

    ${kpisHTML(resumen)}
    ${fuenteResumenHTML(resumen)}

    <div class="card">
      <h2>Registrar ingreso</h2>
      <form id="income-form" class="form-grid">
        <label>Fuente del ingreso
          <input type="text" name="fuente" list="ing-fuentes" autocomplete="off"
            placeholder="Titular, Cónyuge, Freelance…">
          <datalist id="ing-fuentes">
            ${resumen.fuentes.map((f) => `<option value="${esc(f)}">`).join('')}
          </datalist>
        </label>
        <label>Período de pago
          <select name="quincena" id="ing-quincena">
            <option value="q1">1ra quincena (día 1)</option>
            <option value="q2">2da quincena (día 15)</option>
            <option value="exacta">Fecha exacta</option>
          </select>
        </label>
        <label id="ing-mes-grp">Mes y año
          <input type="month" name="mesAnio" value="${month}">
        </label>
        <label id="ing-fecha-grp" style="display:none">Fecha exacta
          <input type="date" name="fecha" value="${todayISO()}">
        </label>
        <label>Tipo / descripción
          <input type="text" name="nombre" required placeholder="Salario, comisión, renta…">
        </label>
        <label>Monto
          <input type="text" name="monto" inputmode="decimal" required placeholder="0.00">
        </label>
        <label>Moneda
          <select name="moneda"><option>RD$</option><option>USD$</option></select>
        </label>
        <label>Cuenta destino
          <input type="text" name="cuenta" list="ing-cuentas" placeholder="BHD, Popular, Efectivo…">
          <datalist id="ing-cuentas">${cuentas.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        </label>
        <div class="full" id="ing-preview" style="display:none"></div>
        <div class="full" style="display:flex;gap:0.5rem">
          <button type="submit" class="btn btn-primary">＋ Registrar ingreso</button>
          <button type="button" class="btn btn-ghost" id="ing-limpiar">Limpiar</button>
        </div>
      </form>
    </div>

    <div class="card">
      <div class="section-head">
        <h2>Historial de ingresos <span class="muted small">· ${txs.length} registro(s)</span></h2>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <select id="filtro-fuente" style="max-width:180px">
            <option value="">Todas las fuentes</option>
            ${resumen.fuentes.map((f) => `<option value="${esc(f)}" ${f === filtroFuente ? 'selected' : ''}>${esc(f)}</option>`).join('')}
          </select>
          <select id="filtro-quincena" style="max-width:160px">
            <option value="">Todas las quincenas</option>
            <option value="1" ${filtroQuincena === '1' ? 'selected' : ''}>1ra quincena</option>
            <option value="2" ${filtroQuincena === '2' ? 'selected' : ''}>2da quincena</option>
          </select>
        </div>
      </div>
      ${historialHTML(txs)}
    </div>

    <div class="card">
      <h2>Ingresos fijos recurrentes <span class="muted small">— aparecen en el Radar cada mes</span></h2>
      <form id="fixed-income-form" class="form-grid">
        <label>Descripción<input type="text" name="descripcion" required placeholder="Salario, renta…"></label>
        <label>Monto RD$<input type="text" name="monto" inputmode="decimal" required placeholder="0.00"></label>
        <label>Día del mes<input type="number" name="dia" min="1" max="31" required placeholder="15"></label>
        <label>Cuenta<input type="text" name="cuenta" placeholder="BHD León…"></label>
        <button type="submit" class="btn btn-primary">＋ Agregar</button>
      </form>
      ${fijosHTML(fijos)}
    </div>
  `;

  bindMonthNav(el, month, (nuevo) => { month = nuevo; render(el); });
  bindForm(el);
  bindHistorial(el, txs);
  bindFijos(el, fijos);
}

// ─── KPIs ──────────────────────────────────────────────────

function kpisHTML(r) {
  const ultimo = r.ultimo
    ? `${fmtMoney(r.ultimo.montoNum, r.ultimo.moneda)}`
    : '—';
  const ultimoFecha = r.ultimo ? fmtFechaDDMM(r.ultimo.fechaSort) : 'sin ingresos';
  const tasaClass = r.tasaAhorro >= 0 ? 'pos' : 'neg';
  const tasaSub = r.deficit ? '⚠ déficit este mes' : 'del ingreso total';
  return `
    <div class="kpis">
      <div class="kpi">
        <div class="kpi-label">Total del mes</div>
        <div class="kpi-value pos">${fmtRD(r.totalMes)}</div>
        <div class="kpi-sub">${r.registros} registro(s)</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Último ingreso</div>
        <div class="kpi-value">${ultimo}</div>
        <div class="kpi-sub">${esc(ultimoFecha)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Promedio mensual</div>
        <div class="kpi-value">${fmtRD(r.promedio3)}</div>
        <div class="kpi-sub">últimos 3 meses</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Tasa de ahorro</div>
        <div class="kpi-value ${tasaClass}">${r.tasaAhorro}%</div>
        <div class="kpi-sub">${tasaSub}</div>
      </div>
    </div>`;
}

function fuenteResumenHTML(r) {
  if (!r.porFuente || r.porFuente.length <= 1) return '';
  const colors = ['var(--viz-tarjetas)', 'var(--viz-prestamos)', 'var(--green)', 'var(--amber)', 'var(--viz-fijos)'];
  return `
    <div class="card">
      <h3>Contribución por fuente</h3>
      ${r.porFuente.map((f, i) => `
        <div style="margin-bottom:0.6rem">
          <div style="display:flex;justify-content:space-between;font-size:0.9rem">
            <span>${esc(f.fuente)}</span>
            <span>${fmtRD(f.total)} <span class="muted">(${f.pct}%)</span></span>
          </div>
          <div class="progress"><i style="width:${Math.min(f.pct, 100)}%;background:${colors[i % colors.length]}"></i></div>
        </div>`).join('')}
    </div>`;
}

// ─── Historial ─────────────────────────────────────────────

function filteredTxs(txs) {
  return txs.filter((t) => {
    if (filtroFuente && (t.fuente || '') !== filtroFuente) return false;
    if (filtroQuincena && String(t.quincena || quincenaOf(t.fechaSort)) !== filtroQuincena) return false;
    return true;
  });
}

function historialHTML(txs) {
  const data = filteredTxs(txs);
  if (data.length === 0) return '<p class="empty-state">Sin ingresos que coincidan</p>';
  const qBadge = (q) => `<span class="badge badge-q${q}">${q === 1 ? '1ra Q' : '2da Q'}</span>`;
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Período</th><th>Fuente / Tipo</th><th>Cuenta</th><th class="right">Monto</th><th></th></tr></thead>
      <tbody>
        ${data.map((t) => {
          const q = t.quincena || quincenaOf(t.fechaSort);
          return `
          <tr>
            <td>${qBadge(q)}<div class="muted small">${fmtFechaDDMM(t.fechaSort)}</div></td>
            <td><strong>${esc(t.fuente || '—')}</strong><div class="muted small">${esc(t.nombre)}</div></td>
            <td class="muted small">${esc(t.cuenta || '')}</td>
            <td class="right pos">+${fmtMoney(t.montoNum, t.moneda)}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm" data-edit-tx="${t.id}" title="Editar">✏️</button>
              <button class="btn btn-sm btn-ghost" data-del-tx="${t.id}" title="Eliminar">🗑</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
}

function fijosHTML(fijos) {
  if (fijos.length === 0) return '<p class="empty-state">Sin ingresos fijos</p>';
  return `
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
              : (f.activo ? `<button class="btn btn-sm btn-success" data-receive="${f.id}">Marcar recibido</button>` : '<span class="muted small">—</span>')}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm" data-toggle-fixed="${f.id}" data-activo="${f.activo ? 1 : 0}">${f.activo ? 'Desactivar' : 'Activar'}</button>
              <button class="btn btn-sm btn-ghost" data-del-fixed="${f.id}" title="Eliminar">🗑</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
}

// ─── Formulario de registro ────────────────────────────────

function bindForm(el) {
  const form = el.querySelector('#income-form');
  const quincenaSel = form.querySelector('#ing-quincena');
  const mesGrp = el.querySelector('#ing-mes-grp');
  const fechaGrp = el.querySelector('#ing-fecha-grp');
  const montoInput = form.querySelector('[name=monto]');
  const preview = el.querySelector('#ing-preview');
  attachMoney(montoInput);

  const toggleFechas = () => {
    const exacta = quincenaSel.value === 'exacta';
    mesGrp.style.display = exacta ? 'none' : '';
    fechaGrp.style.display = exacta ? '' : 'none';
  };
  const updatePreview = () => {
    const fuente = form.fuente.value.trim();
    const monto = moneyToNum(montoInput);
    const nombre = form.nombre.value.trim();
    if (!monto || (!fuente && !nombre)) { preview.style.display = 'none'; return; }
    const q = quincenaSel.value;
    const periodo = q === 'exacta'
      ? fmtFechaDDMM(form.fecha.value)
      : `${q === 'q1' ? '1ra' : '2da'} Q · ${form.mesAnio.value}`;
    preview.style.display = '';
    preview.className = 'full';
    preview.innerHTML = `<div style="padding:10px 14px;background:var(--green-soft);border:1px solid var(--green);border-radius:8px;color:var(--green);font-size:0.85rem">
      ✓ ${esc(fuente || '—')} — ${esc(nombre || 'ingreso')} · +${fmtMoney(monto, form.moneda.value)} · ${esc(form.cuenta.value.trim() || 'cuenta')} · ${esc(periodo)}</div>`;
  };

  quincenaSel.addEventListener('change', () => { toggleFechas(); updatePreview(); });
  ['fuente', 'nombre', 'moneda', 'cuenta', 'mesAnio', 'fecha'].forEach((n) => {
    form[n].addEventListener('input', updatePreview);
  });
  montoInput.addEventListener('input', updatePreview);
  toggleFechas();

  el.querySelector('#ing-limpiar').onclick = () => {
    form.fuente.value = '';
    montoInput.value = '';
    form.nombre.value = '';
    preview.style.display = 'none';
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const monto = moneyToNum(montoInput);
    if (monto <= 0) return toast('Ingresa un monto válido', 'error');

    const q = quincenaSel.value;
    let fechaSort;
    let quincena;
    if (q === 'exacta') {
      fechaSort = form.fecha.value;
      if (!fechaSort) return toast('Selecciona una fecha', 'error');
    } else {
      const mesAnio = form.mesAnio.value; // YYYY-MM
      if (!mesAnio) return toast('Selecciona el mes', 'error');
      fechaSort = `${mesAnio}-${q === 'q1' ? '01' : '15'}`;
      quincena = q === 'q1' ? 1 : 2;
    }

    try {
      await apiPost('/api/transactions', {
        nombre: form.nombre.value.trim(),
        montoNum: monto,
        moneda: form.moneda.value,
        fuente: form.fuente.value.trim() || undefined,
        cuenta: form.cuenta.value.trim() || undefined,
        fechaSort,
        quincena,
        neg: false
      });
      toast('Ingreso registrado', 'success');
      // vuelve a ese mes para ver el registro recién creado
      month = fechaSort.slice(0, 7);
      render(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ─── Historial: filtros, editar, eliminar ──────────────────

function bindHistorial(el, txs) {
  el.querySelector('#filtro-fuente').onchange = (e) => {
    filtroFuente = e.target.value;
    render(el);
  };
  el.querySelector('#filtro-quincena').onchange = (e) => {
    filtroQuincena = e.target.value;
    render(el);
  };

  el.querySelectorAll('[data-edit-tx]').forEach((b) => {
    b.onclick = () => openEditModal(el, txs.find((t) => t.id === Number(b.dataset.editTx)));
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
}

function openEditModal(el, t) {
  if (!t) return;
  const q = t.quincena || quincenaOf(t.fechaSort);
  const m = openModal(`
    <h2>Editar ingreso</h2>
    <form id="edit-ing" class="form-grid">
      <label>Fuente<input type="text" name="fuente" value="${esc(t.fuente || '')}"></label>
      <label>Tipo / descripción<input type="text" name="nombre" required value="${esc(t.nombre)}"></label>
      <label>Monto<input type="text" name="monto" inputmode="decimal" value="${moneyStr(t.montoNum)}"></label>
      <label>Moneda
        <select name="moneda">
          <option ${t.moneda === 'RD$' ? 'selected' : ''}>RD$</option>
          <option ${t.moneda === 'USD$' ? 'selected' : ''}>USD$</option>
        </select>
      </label>
      <label>Cuenta<input type="text" name="cuenta" value="${esc(t.cuenta || '')}"></label>
      <label>Fecha<input type="date" name="fecha" value="${esc(t.fechaSort)}"></label>
      <label>Quincena
        <select name="quincena">
          <option value="1" ${q === 1 ? 'selected' : ''}>1ra quincena</option>
          <option value="2" ${q === 2 ? 'selected' : ''}>2da quincena</option>
        </select>
      </label>
    </form>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn btn-primary" data-act="save">Guardar cambios</button>
    </div>
  `);
  const form = m.el.querySelector('#edit-ing');
  attachMoney(form.monto);
  m.el.querySelector('[data-act="cancel"]').onclick = m.close;
  m.el.querySelector('[data-act="save"]').onclick = async () => {
    const monto = moneyToNum(form.monto);
    if (monto <= 0) return toast('Monto inválido', 'error');
    try {
      await apiPut(`/api/transactions/${t.id}`, {
        nombre: form.nombre.value.trim(),
        montoNum: monto,
        moneda: form.moneda.value,
        fuente: form.fuente.value.trim() || undefined,
        cuenta: form.cuenta.value.trim() || undefined,
        fechaSort: form.fecha.value,
        quincena: Number(form.quincena.value),
        neg: false
      });
      m.close();
      toast('Ingreso actualizado', 'success');
      month = form.fecha.value.slice(0, 7);
      render(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ─── Ingresos fijos ────────────────────────────────────────

function bindFijos(el, fijos) {
  const form = el.querySelector('#fixed-income-form');
  attachMoney(form.monto);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const monto = moneyToNum(form.monto);
    if (monto <= 0) return toast('Ingresa un monto válido', 'error');
    try {
      await apiPost('/api/fixed-incomes', {
        descripcion: form.descripcion.value.trim(),
        monto,
        dia: Number(form.dia.value),
        cuenta: form.cuenta.value.trim() || undefined
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

  el.querySelectorAll('[data-toggle-fixed]').forEach((b) => {
    b.onclick = async () => {
      try {
        await apiPut(`/api/fixed-incomes/${b.dataset.toggleFixed}`, { activo: b.dataset.activo !== '1' });
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
