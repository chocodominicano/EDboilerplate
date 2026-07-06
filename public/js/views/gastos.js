import { apiGet, apiPost, apiDelete } from '../api.js';
import { esc, toast, confirmDialog } from '../ui.js';
import { fmtRD, fmtMoney, fmtFechaDDMM, todayISO, currentMonthKey } from '../format.js';
import { monthNavHTML, bindMonthNav } from '../monthnav.js';

const CATEGORIAS = ['Comida', 'Transporte', 'Servicios', 'Salud', 'Entretenimiento',
  'Educación', 'Hogar', 'Ropa', 'Préstamos', 'Gastos fijos', 'Otros'];

let month = null;
let tab = 'mes';
let cycleCard = '';

export async function render(el) {
  if (!month) month = currentMonthKey();
  const cards = await apiGet('/api/cards');
  if (cycleCard && !cards.some((c) => c.key === cycleCard)) cycleCard = '';
  if (!cycleCard && cards.length > 0) cycleCard = cards[0].key;

  el.innerHTML = `
    <div class="section-head">
      <h1>Gastos</h1>
      ${monthNavHTML(month)}
    </div>

    <div class="card">
      <h2>Registrar gasto</h2>
      <form id="expense-form" class="form-grid">
        <label class="full">Descripción
          <input type="text" name="nombre" required placeholder="Ej. Supermercado, gasolina…">
        </label>
        <label>Monto
          <input type="number" name="montoNum" step="0.01" min="0.01" required>
        </label>
        <label>Moneda
          <select name="moneda"><option>RD$</option><option>USD$</option></select>
        </label>
        <label>Categoría
          <select name="cat">${CATEGORIAS.map((c) => `<option>${c}</option>`).join('')}</select>
        </label>
        <label>Método de pago
          <select name="metodo">
            <option value="Efectivo">Efectivo</option>
            <option value="Transferencia">Transferencia</option>
            <option value="Débito">Débito</option>
            ${cards.map((c) => `<option value="cc:${esc(c.key)}">💳 ${esc(c.label)}</option>`).join('')}
          </select>
        </label>
        <label>Fecha
          <input type="date" name="fechaSort" value="${todayISO()}" required>
        </label>
        <label>Tags <span class="muted small">(separados por coma)</span>
          <input type="text" name="tags" placeholder="mercado, casa">
        </label>
        <button type="submit" class="btn btn-primary">＋ Agregar</button>
      </form>
    </div>

    <div class="tabs">
      <button data-tab="mes" class="${tab === 'mes' ? 'active' : ''}">Por mes</button>
      <button data-tab="ciclo" class="${tab === 'ciclo' ? 'active' : ''}">Por ciclo de tarjeta</button>
      <button data-tab="fijos" class="${tab === 'fijos' ? 'active' : ''}">📌 Gastos fijos</button>
    </div>

    <div id="gastos-tab-body"></div>
  `;

  bindMonthNav(el, month, (nuevo) => { month = nuevo; render(el); });

  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { tab = b.dataset.tab; render(el); };
  });

  el.querySelector('#expense-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const metodo = f.get('metodo');
    const isCC = metodo.startsWith('cc:');
    const card = isCC ? cards.find((c) => c.key === metodo.slice(3)) : null;
    try {
      await apiPost('/api/transactions', {
        nombre: f.get('nombre'),
        montoNum: Number(f.get('montoNum')),
        moneda: f.get('moneda'),
        cat: f.get('cat'),
        metodo: card ? card.label : metodo,
        ccKey: card ? card.key : undefined,
        fechaSort: f.get('fechaSort'),
        tags: String(f.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
        neg: true
      });
      toast('Gasto registrado', 'success');
      render(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const body = el.querySelector('#gastos-tab-body');
  if (tab === 'mes') await renderMes(body, el);
  else if (tab === 'ciclo') await renderCiclo(body, el, cards);
  else await renderFijos(body, el);
}

function txTable(txs) {
  if (txs.length === 0) return '<p class="empty-state">Sin gastos en este período</p>';
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Método</th><th>Tags</th><th class="right">Monto</th><th></th></tr></thead>
      <tbody>
        ${txs.map((t) => `
          <tr>
            <td class="muted">${fmtFechaDDMM(t.fechaSort)}</td>
            <td>${esc(t.nombre)}</td>
            <td class="muted">${esc(t.cat || '')}</td>
            <td class="muted">${esc(t.metodo || '')}</td>
            <td>${(t.tags || []).map((g) => `<span class="tag">${esc(g)}</span>`).join('')}</td>
            <td class="right neg">−${fmtMoney(t.montoNum, t.moneda)}</td>
            <td><button class="btn btn-sm btn-ghost" data-del-tx="${t.id}" title="Eliminar">🗑</button></td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function bindDeleteTx(body, viewEl) {
  body.querySelectorAll('[data-del-tx]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('¿Eliminar este gasto? Si fue con tarjeta, el saldo usado se revierte.', { danger: true, okLabel: 'Eliminar' })) return;
      try {
        await apiDelete(`/api/transactions/${b.dataset.delTx}`);
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}

async function renderMes(body, viewEl) {
  const txs = await apiGet(`/api/transactions?month=${month}&kind=gasto`);
  const totalRD = txs.reduce((a, t) => a + (t.moneda === 'USD$' ? 0 : t.montoNum), 0);
  const totalUSD = txs.reduce((a, t) => a + (t.moneda === 'USD$' ? t.montoNum : 0), 0);
  body.innerHTML = `
    <div class="card">
      <h2>Gastos del mes
        <span class="muted small">· ${fmtRD(totalRD)}${totalUSD > 0 ? ` + ${fmtMoney(totalUSD, 'USD$')}` : ''}</span>
      </h2>
      ${txTable(txs)}
    </div>`;
  bindDeleteTx(body, viewEl);
}

async function renderCiclo(body, viewEl, cards) {
  if (cards.length === 0) {
    body.innerHTML = '<div class="card"><p class="empty-state">Registra una tarjeta para ver gastos por ciclo de corte</p></div>';
    return;
  }
  const card = cards.find((c) => c.key === cycleCard) || cards[0];
  const txs = await apiGet(`/api/transactions?ccKey=${encodeURIComponent(card.key)}&cycle=current&kind=gasto`);
  const total = txs.reduce((a, t) => a + (t.moneda === 'USD$' ? 0 : t.montoNum), 0);
  body.innerHTML = `
    <div class="card">
      <div class="section-head">
        <h2>Ciclo actual · ${esc(card.label)}</h2>
        <select id="cycle-card-sel" style="max-width:220px">
          ${cards.map((c) => `<option value="${esc(c.key)}" ${c.key === card.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
        </select>
      </div>
      <p class="muted small">Del ${fmtFechaDDMM(card.cicloActual.start)} al ${fmtFechaDDMM(card.cicloActual.end)} (corte día ${card.diaCorte}) · consumos del ciclo: ${fmtRD(total)}</p>
      ${txTable(txs)}
    </div>`;
  body.querySelector('#cycle-card-sel').onchange = (e) => {
    cycleCard = e.target.value;
    render(viewEl);
  };
  bindDeleteTx(body, viewEl);
}

async function renderFijos(body, viewEl) {
  const fijos = await apiGet(`/api/fixed-expenses?month=${month}`);
  const q1 = fijos.filter((f) => f.quincena === 1 && f.activo);
  const q2 = fijos.filter((f) => f.quincena === 2 && f.activo);
  const totQ1 = q1.reduce((a, f) => a + f.monto, 0);
  const totQ2 = q2.reduce((a, f) => a + f.monto, 0);

  const estadoBadge = (e) => ({
    pagado: '<span class="badge badge-ok">pagado</span>',
    pendiente: '<span class="badge badge-warn">pendiente</span>',
    vencido: '<span class="badge badge-danger">vencido</span>',
    inactivo: '<span class="badge badge-muted">inactivo</span>'
  }[e] || '');

  const rows = (list) => list.map((f) => `
    <tr>
      <td>${f.dia}</td>
      <td>${esc(f.concepto)}</td>
      <td class="muted">${esc(f.cat || '')}</td>
      <td class="right">${fmtRD(f.monto)}</td>
      <td>${estadoBadge(f.estado)}</td>
      <td>
        ${f.estado !== 'pagado' && f.activo ? `<button class="btn btn-sm btn-success" data-pay-fixed="${f.id}">Pagar</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-del-fixedexp="${f.id}" title="Eliminar">🗑</button>
      </td>
    </tr>`).join('');

  body.innerHTML = `
    <div class="card">
      <h2>Gastos fijos del mes</h2>
      <form id="fixed-exp-form" class="form-grid">
        <label>Concepto<input type="text" name="concepto" required placeholder="Internet, renta…"></label>
        <label>Monto RD$<input type="number" name="monto" step="0.01" min="0.01" required></label>
        <label>Día del mes<input type="number" name="dia" min="1" max="31" required></label>
        <label>Categoría
          <select name="cat">${CATEGORIAS.map((c) => `<option>${c}</option>`).join('')}</select>
        </label>
        <button type="submit" class="btn btn-primary">＋</button>
      </form>
    </div>

    <div class="split-2">
      <div class="card">
        <h3><span class="badge badge-q1">Q1</span> Días 1–15 · total ${fmtRD(totQ1)}</h3>
        ${q1.length === 0 ? '<p class="empty-state">Sin compromisos en Q1</p>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>Día</th><th>Concepto</th><th>Cat</th><th class="right">Monto</th><th>Estado</th><th></th></tr></thead>
          <tbody>${rows(q1)}</tbody>
        </table></div>`}
      </div>
      <div class="card">
        <h3><span class="badge badge-q2">Q2</span> Días 16–fin · total ${fmtRD(totQ2)}</h3>
        ${q2.length === 0 ? '<p class="empty-state">Sin compromisos en Q2</p>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>Día</th><th>Concepto</th><th>Cat</th><th class="right">Monto</th><th>Estado</th><th></th></tr></thead>
          <tbody>${rows(q2)}</tbody>
        </table></div>`}
      </div>
    </div>
  `;

  body.querySelector('#fixed-exp-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await apiPost('/api/fixed-expenses', {
        concepto: f.get('concepto'),
        monto: Number(f.get('monto')),
        dia: Number(f.get('dia')),
        cat: f.get('cat')
      });
      toast('Gasto fijo creado', 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  body.querySelectorAll('[data-pay-fixed]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('¿Marcar como pagado y registrar el gasto?', { okLabel: 'Pagar' })) return;
      try {
        await apiPost(`/api/fixed-expenses/${b.dataset.payFixed}/pay`, { month });
        toast('Gasto fijo pagado', 'success');
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  body.querySelectorAll('[data-del-fixedexp]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('¿Eliminar este gasto fijo?', { danger: true, okLabel: 'Eliminar' })) return;
      try {
        await apiDelete(`/api/fixed-expenses/${b.dataset.delFixedexp}`);
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}
