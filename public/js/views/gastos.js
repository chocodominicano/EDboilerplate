import { apiGet, apiPost, apiDelete } from '../api.js';
import { esc, toast, confirmDialog, openModal, progressBar } from '../ui.js';
import { fmtRD, fmtUSD, fmtMoney, fmtFechaDDMM, todayISO, currentMonthKey } from '../format.js';
import { monthNavHTML, bindMonthNav } from '../monthnav.js';
import { attachMoney, moneyToNum } from '../money.js';

// Catálogos administrados desde el panel admin (con fallback si fallan)
let CATEGORIAS = ['Comida', 'Transporte', 'Servicios', 'Salud', 'Entretenimiento',
  'Educación', 'Hogar', 'Ropa', 'Préstamos', 'Gastos fijos', 'Otros'];
let METODOS = ['Efectivo', 'Transferencia', 'Débito'];

// Cargos que el banco aplica directamente (no son consumos del usuario)
const INTERES_TIPOS = {
  interes_compra: { cat: 'Intereses', icon: '📈', desc: 'Interés por compras' },
  interes_sobregiro: { cat: 'Intereses', icon: '⚠️', desc: 'Interés por sobregiro' },
  mora: { cat: 'Mora', icon: '🔴', desc: 'Cargo por mora' },
  cargo_anual: { cat: 'Comisiones', icon: '📋', desc: 'Cargo anual' },
  seguro: { cat: 'Seguro', icon: '🛡️', desc: 'Seguro de tarjeta' },
  otro_cargo: { cat: 'Bancario', icon: '🏦', desc: 'Otro cargo bancario' }
};

let month = null;
let tab = 'mes';
let formTab = 'consumo';
let cycleCard = '';
let catFilter = '';
let tagFilter = '';
let tagBarOpen = false;

export async function render(el) {
  if (!month) month = currentMonthKey();
  const [cards, catalog, resumen, budgets, fixedExpAll, monthGastos] = await Promise.all([
    apiGet('/api/cards'),
    apiGet('/api/catalog').catch(() => null),
    apiGet(`/api/gastos/resumen?month=${month}`),
    apiGet(`/api/budgets?month=${month}`),
    apiGet(`/api/fixed-expenses?month=${month}`),
    apiGet(`/api/transactions?month=${month}&kind=gasto`)
  ]);
  if (catalog?.categories?.length) CATEGORIAS = catalog.categories;
  if (catalog?.paymentMethods?.length) METODOS = catalog.paymentMethods;
  if (cycleCard && !cards.some((c) => c.key === cycleCard)) cycleCard = '';
  if (!cycleCard && cards.length > 0) cycleCard = cards[0].key;

  const cardsByKey = new Map(cards.map((c) => [c.key, c]));
  const budgetsMap = new Map(budgets.map((b) => [b.cat, b]));

  el.innerHTML = `
    <div class="section-head">
      <h1>Gastos</h1>
      ${monthNavHTML(month)}
    </div>

    ${kpisHTML(resumen)}

    <div class="card">
      <div class="tabs">
        <button data-formtab="consumo" class="${formTab === 'consumo' ? 'active' : ''}">🛒 Registrar consumo</button>
        <button data-formtab="cargo" class="${formTab === 'cargo' ? 'active' : ''}">🏦 Registrar cargo bancario</button>
      </div>
      <div id="gastos-form-body"></div>
    </div>

    <div class="tabs">
      <button data-tab="mes" class="${tab === 'mes' ? 'active' : ''}">Por mes</button>
      <button data-tab="ciclo" class="${tab === 'ciclo' ? 'active' : ''}">Por ciclo de tarjeta</button>
      <button data-tab="fijos" class="${tab === 'fijos' ? 'active' : ''}">📌 Gastos fijos</button>
    </div>

    <div id="gastos-tab-body"></div>
  `;

  bindMonthNav(el, month, (nuevo) => { month = nuevo; render(el); });

  el.querySelectorAll('[data-formtab]').forEach((b) => {
    b.onclick = () => { formTab = b.dataset.formtab; render(el); };
  });
  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { tab = b.dataset.tab; render(el); };
  });

  const formBody = el.querySelector('#gastos-form-body');
  if (formTab === 'consumo') renderConsumoForm(formBody, el, cards);
  else renderCargoForm(formBody, el, cards);

  bindKpis(el, resumen, monthGastos);

  const body = el.querySelector('#gastos-tab-body');
  if (tab === 'mes') renderMes(body, el, monthGastos, cardsByKey, budgetsMap, fixedExpAll);
  else if (tab === 'ciclo') await renderCiclo(body, el, cards, budgetsMap, fixedExpAll);
  else await renderFijos(body, el);
}

// ─── KPIs ──────────────────────────────────────────────────

function kpisHTML(r) {
  const balanceSign = r.balance >= 0 ? '+' : '';
  return `
    <div class="kpis">
      <div class="kpi kpi-click" id="kpi-total-mes">
        <div class="kpi-label">Total del mes ↗</div>
        <div class="kpi-value neg">${fmtRD(r.totalEquivRD)}</div>
        <div class="kpi-sub">${r.txCount} transacción(es) este mes</div>
      </div>
      <div class="kpi kpi-click" id="kpi-usd">
        <div class="kpi-label">Gastos USD$ ↗</div>
        <div class="kpi-value">${fmtUSD(r.totalUSD)}</div>
        <div class="kpi-sub">≈ ${fmtRD(r.usdEnRD)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Balance disponible</div>
        <div class="kpi-value ${r.balance >= 0 ? 'pos' : 'neg'}">${balanceSign}${fmtRD(r.balance)}</div>
        <div class="kpi-sub">después de gastos</div>
      </div>
    </div>`;
}

function bindKpis(viewEl, resumen, monthGastos) {
  viewEl.querySelector('#kpi-total-mes').onclick = () => openDesgloseModal(viewEl, resumen);
  viewEl.querySelector('#kpi-usd').onclick = () => openUsdModal(viewEl, monthGastos);
}

function openDesgloseModal(viewEl, resumen) {
  const m = openModal(`
    <h2>Gastos por categoría</h2>
    ${resumen.porCategoria.length === 0 ? '<p class="empty-state">Sin gastos este mes</p>' : `
    <p class="muted small">Clic en una categoría para filtrar la tabla</p>
    ${resumen.porCategoria.map((c) => `
      <button type="button" class="cat-bar-row" data-cat="${esc(c.cat)}">
        <div style="display:flex;justify-content:space-between;font-size:0.9rem">
          <span>${esc(c.cat)}</span><span>${fmtRD(c.total)} <span class="muted">(${c.pct}%)</span></span>
        </div>
        ${progressBar(c.pct)}
      </button>`).join('')}`}
    <div class="modal-actions"><button class="btn" data-act="close">Cerrar</button></div>
  `);
  m.el.querySelector('[data-act="close"]').onclick = m.close;
  m.el.querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = () => {
      catFilter = b.dataset.cat;
      m.close();
      render(viewEl);
    };
  });
}

function openUsdModal(viewEl, monthGastos) {
  const usdTxs = monthGastos.filter((t) => t.moneda === 'USD$');
  const m = openModal(`
    <h2>Gastos en USD$ este mes</h2>
    ${usdTxs.length === 0 ? '<p class="empty-state">Sin gastos en USD$ este mes</p>' : `
    <div class="table-wrap"><table>
      <tbody>
        ${usdTxs.map((t) => `
          <tr>
            <td class="muted">${fmtFechaDDMM(t.fechaSort)}</td>
            <td>${esc(t.nombre)}</td>
            <td class="muted">${esc(t.cat || '')}</td>
            <td class="right neg">${fmtUSD(t.montoNum)}</td>
          </tr>`).join('')}
      </tbody>
    </table></div>`}
    <div class="modal-actions"><button class="btn" data-act="close">Cerrar</button></div>
  `);
  m.el.querySelector('[data-act="close"]').onclick = m.close;
}

// ─── Formulario: Registrar consumo ──────────────────────────

function renderConsumoForm(body, viewEl, cards) {
  body.innerHTML = `
    <form id="expense-form" class="form-grid" style="margin-top:1rem">
      <label class="full">Descripción
        <input type="text" name="nombre" required placeholder="Ej. Supermercado, gasolina…">
      </label>
      <label>Monto
        <input type="text" name="monto" inputmode="decimal" required placeholder="0.00">
      </label>
      <label>Moneda
        <select name="moneda"><option>RD$</option><option>USD$</option></select>
      </label>
      <label>Categoría
        <select name="cat">${CATEGORIAS.map((c) => `<option>${c}</option>`).join('')}</select>
      </label>
      <label>Método de pago
        <select name="metodo">
          ${METODOS.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
          ${cards.map((c) => `<option value="cc:${esc(c.key)}">💳 ${esc(c.label)}</option>`).join('')}
        </select>
      </label>
      <label>Fecha
        <input type="date" name="fechaSort" value="${todayISO()}" required>
      </label>
      <label>Tags <span class="muted small">(separados por coma)</span>
        <input type="text" name="tags" placeholder="mercado, casa">
      </label>
      <p id="usd-warn" class="full small hidden" style="color:var(--amber)"></p>
      <div class="full" style="display:flex;gap:0.5rem">
        <button type="submit" class="btn btn-primary">＋ Agregar</button>
        <button type="button" class="btn btn-ghost btn-sm" id="open-csv">⬆ Importar CSV</button>
      </div>
    </form>
  `;

  const form = body.querySelector('#expense-form');
  attachMoney(form.monto);

  const warnEl = form.querySelector('#usd-warn');
  function checkUsdWarn() {
    const metodo = form.metodo.value;
    const card = metodo.startsWith('cc:') ? cards.find((c) => c.key === metodo.slice(3)) : null;
    if (form.moneda.value === 'USD$' && card && !card.dobleSaldo) {
      warnEl.textContent = `⚠ ${card.label} no tiene saldo USD$ configurado — el cargo se registrará igual, pero revisa la tarjeta.`;
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
    }
  }
  form.moneda.addEventListener('change', checkUsdWarn);
  form.metodo.addEventListener('change', checkUsdWarn);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const monto = moneyToNum(form.monto);
    if (monto <= 0) return toast('Ingresa un monto válido', 'error');
    const metodo = form.metodo.value;
    const isCC = metodo.startsWith('cc:');
    const card = isCC ? cards.find((c) => c.key === metodo.slice(3)) : null;
    try {
      await apiPost('/api/transactions', {
        nombre: form.nombre.value.trim(),
        montoNum: monto,
        moneda: form.moneda.value,
        cat: form.cat.value,
        metodo: card ? card.label : metodo,
        ccKey: card ? card.key : undefined,
        fechaSort: form.fechaSort.value,
        tags: String(form.tags.value || '').split(',').map((t) => t.trim()).filter(Boolean),
        neg: true
      });
      toast('Gasto registrado', 'success');
      month = form.fechaSort.value.slice(0, 7);
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  body.querySelector('#open-csv').onclick = () => openCsvModal(viewEl, cards);
}

// ─── Formulario: Cargo bancario ─────────────────────────────

function renderCargoForm(body, viewEl, cards) {
  body.innerHTML = `
    <div class="full" style="border-left:3px solid var(--amber);padding:0.6rem 0.9rem;background:var(--amber-soft);border-radius:6px;margin-top:1rem">
      Registra aquí los cargos que el banco te aplica directamente (intereses, mora, seguro, cargo anual) —
      no son consumos tuyos, pero sí reducen tu dinero disponible.
    </div>
    <form id="cargo-form" class="form-grid" style="margin-top:1rem">
      <label>Fecha<input type="date" name="fecha" value="${todayISO()}" required></label>
      <label>Monto<input type="text" name="monto" inputmode="decimal" required placeholder="0.00"></label>
      <label>Tipo de cargo
        <select name="tipo">
          ${Object.entries(INTERES_TIPOS).map(([k, v]) => `<option value="${k}">${v.icon} ${v.desc}</option>`).join('')}
        </select>
      </label>
      <label>Tarjeta afectada
        <select name="cardKey">
          <option value="">— Ninguna / general —</option>
          ${cards.map((c) => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}
        </select>
      </label>
      <label>Moneda<select name="moneda"><option>RD$</option><option>USD$</option></select></label>
      <button type="submit" class="btn btn-primary full">＋ Registrar cargo</button>
    </form>
  `;

  const form = body.querySelector('#cargo-form');
  attachMoney(form.monto);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const monto = moneyToNum(form.monto);
    if (monto <= 0) return toast('Ingresa un monto válido', 'error');
    const tipoInfo = INTERES_TIPOS[form.tipo.value];
    const card = form.cardKey.value ? cards.find((c) => c.key === form.cardKey.value) : null;
    try {
      await apiPost('/api/transactions', {
        nombre: tipoInfo.desc + (card ? ` — ${card.label}` : ''),
        montoNum: monto,
        moneda: form.moneda.value,
        cat: tipoInfo.cat,
        metodo: card ? card.label : 'Banco',
        ccKey: card ? card.key : undefined,
        fechaSort: form.fecha.value,
        tags: ['cargo-bancario'],
        icon: tipoInfo.icon,
        neg: true
      });
      toast('Cargo bancario registrado', 'success');
      month = form.fecha.value.slice(0, 7);
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ─── Importación CSV ────────────────────────────────────────

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function openCsvModal(viewEl, cards) {
  const m = openModal(`
    <h2>Importar gastos desde CSV</h2>
    <p class="muted small">Formato: <code>fecha,descripcion,categoria,monto,metodo</code> (fecha en yyyy-mm-dd, con encabezado o sin él).</p>
    <input type="file" id="csv-file" accept=".csv,text/csv">
    <div id="csv-result" class="small" style="margin-top:0.75rem"></div>
    <div class="modal-actions"><button class="btn" data-act="close">Cerrar</button></div>
  `);
  m.el.querySelector('[data-act="close"]').onclick = () => { m.close(); render(viewEl); };

  m.el.querySelector('#csv-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const resultEl = m.el.querySelector('#csv-result');
    resultEl.textContent = 'Importando…';

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let rows = lines.map(parseCsvLine);
    if (rows.length && /fecha/i.test(rows[0][0] || '')) rows = rows.slice(1); // quita encabezado

    let ok = 0;
    const errores = [];
    for (const [fecha, descripcion, categoria, montoStr, metodoTxt] of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) { errores.push(`"${descripcion || fecha}": fecha inválida`); continue; }
      const montoNum = Number(String(montoStr || '').replace(/,/g, ''));
      if (!Number.isFinite(montoNum) || montoNum <= 0) { errores.push(`"${descripcion}": monto inválido`); continue; }

      const metodoLimpio = (metodoTxt || '').replace(/\s*\((?:RD|USD)\$\)\s*$/i, '').trim();
      const isUSD = /\(USD\$\)\s*$/i.test(metodoTxt || '');
      const card = metodoLimpio ? cards.find((c) => c.label.toLowerCase() === metodoLimpio.toLowerCase()) : null;

      try {
        await apiPost('/api/transactions', {
          nombre: descripcion || 'Gasto importado',
          montoNum,
          moneda: isUSD ? 'USD$' : 'RD$',
          cat: categoria || 'Otros',
          metodo: card ? card.label : (metodoTxt || undefined),
          ccKey: card ? card.key : undefined,
          fechaSort: fecha,
          neg: true
        });
        ok++;
      } catch (err) {
        errores.push(`"${descripcion}": ${err.message}`);
      }
    }

    resultEl.innerHTML = `✓ ${ok} importado(s)${errores.length ? ` · ✗ ${errores.length} con error` : ''}` +
      (errores.length ? `<ul class="muted small">${errores.slice(0, 10).map((e2) => `<li>${esc(e2)}</li>`).join('')}</ul>` : '');
    if (ok > 0) toast(`${ok} gasto(s) importado(s)`, 'success');
  });
}

// ─── Filtros compartidos ─────────────────────────────────────

function applyFilters(txs) {
  return txs.filter((t) => {
    if (catFilter && (t.cat || '') !== catFilter) return false;
    if (tagFilter && !(t.tags || []).includes(tagFilter)) return false;
    return true;
  });
}

function filterBannerHTML() {
  if (!catFilter && !tagFilter) return '';
  const parts = [];
  if (catFilter) parts.push(`Categoría: <strong>${esc(catFilter)}</strong> <a data-clear="cat">✕</a>`);
  if (tagFilter) parts.push(`Etiqueta: <strong>#${esc(tagFilter)}</strong> <a data-clear="tag">✕</a>`);
  return `<div class="filter-banner">🔍 Filtrando por — ${parts.join(' · ')}</div>`;
}

function bindFilterBanner(body, viewEl) {
  body.querySelectorAll('[data-clear]').forEach((a) => {
    a.onclick = () => {
      if (a.dataset.clear === 'cat') catFilter = '';
      else tagFilter = '';
      render(viewEl);
    };
  });
}

function tagFilterBarHTML(txs) {
  const tags = [...new Set(txs.flatMap((t) => t.tags || []))].sort();
  if (tags.length === 0) return '';
  return `
    <button type="button" class="btn btn-sm btn-ghost" id="toggle-tag-bar" style="margin-bottom:0.5rem">
      🏷 ${tagBarOpen ? 'Ocultar' : 'Filtrar por'} etiquetas
    </button>
    <div class="tag-filter-bar ${tagBarOpen ? '' : 'hidden'}" id="tag-filter-bar">
      ${tags.map((t) => `<button type="button" class="${t === tagFilter ? 'active' : ''}" data-settag="${esc(t)}">#${esc(t)}</button>`).join('')}
    </div>`;
}

function bindTagFilterBar(body, viewEl) {
  const toggle = body.querySelector('#toggle-tag-bar');
  if (toggle) toggle.onclick = () => { tagBarOpen = !tagBarOpen; render(viewEl); };
  body.querySelectorAll('[data-settag]').forEach((b) => {
    b.onclick = () => { tagFilter = tagFilter === b.dataset.settag ? '' : b.dataset.settag; render(viewEl); };
  });
}

// ─── Tabla de transacciones ──────────────────────────────────

function budgetBadge(budgetsMap, cat) {
  const b = budgetsMap.get(cat);
  if (!b) return '';
  const cls = b.pct > 100 ? 'badge-danger' : (b.pct >= 80 ? 'badge-warn' : 'badge-ok');
  return ` <span class="badge ${cls}" title="Presupuesto: ${fmtRD(b.monto)}">${b.pct}% presup.</span>`;
}

function cicloWarning(t, cardsByKey) {
  if (!t.ccKey) return '';
  const card = cardsByKey.get(t.ccKey);
  if (!card) return '';
  const dia = Number(t.fechaSort.slice(8, 10));
  if (dia > card.diaCorte) return ' <span class="badge badge-muted" title="El día de corte ya pasó">→ próximo ciclo</span>';
  return '';
}

function txTable(txs, { budgetsMap = new Map(), cardsByKey = new Map(), showCicloWarn = false } = {}) {
  if (txs.length === 0) return '<p class="empty-state">Sin gastos que coincidan</p>';
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Método</th><th>Tags</th><th class="right">Monto</th><th></th></tr></thead>
      <tbody>
        ${txs.map((t) => `
          <tr>
            <td class="muted">${fmtFechaDDMM(t.fechaSort)}${showCicloWarn ? cicloWarning(t, cardsByKey) : ''}</td>
            <td>${esc(t.nombre)}</td>
            <td>${t.cat ? `<span class="tag clickable" data-cat="${esc(t.cat)}">${esc(t.cat)}</span>` : ''}${budgetBadge(budgetsMap, t.cat)}</td>
            <td class="muted">${esc(t.metodo || '')}</td>
            <td>${(t.tags || []).map((g) => `<span class="tag clickable" data-tag="${esc(g)}">${esc(g)}</span>`).join('')}</td>
            <td class="right neg">−${fmtMoney(t.montoNum, t.moneda)}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm" data-convert="${t.id}" title="Convertir a gasto fijo">📌</button>
              <button class="btn btn-sm btn-ghost" data-del-tx="${t.id}" title="Eliminar">🗑</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function bindTxTable(body, viewEl, txs, fixedExpAll) {
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

  body.querySelectorAll('[data-cat]').forEach((el) => {
    el.onclick = () => { catFilter = catFilter === el.dataset.cat ? '' : el.dataset.cat; render(viewEl); };
  });
  body.querySelectorAll('[data-tag]').forEach((el) => {
    el.onclick = () => { tagFilter = tagFilter === el.dataset.tag ? '' : el.dataset.tag; render(viewEl); };
  });

  body.querySelectorAll('[data-convert]').forEach((b) => {
    const t = txs.find((x) => x.id === Number(b.dataset.convert));
    b.onclick = () => openConvertModal(viewEl, t, fixedExpAll);
  });
}

function openConvertModal(viewEl, t, fixedExpAll) {
  const dup = fixedExpAll.some((fe) => fe.concepto.toLowerCase() === t.nombre.toLowerCase());
  if (dup) return toast('Ya existe un gasto fijo con ese concepto', 'error');

  const dia = Number(t.fechaSort.slice(8, 10));
  const m = openModal(`
    <h2>Convertir a gasto fijo</h2>
    <p class="muted small">Se creará un gasto fijo recurrente basado en esta transacción.</p>
    <form id="convert-form" class="form-grid">
      <label class="full">Concepto<input type="text" name="concepto" required value="${esc(t.nombre)}"></label>
      <label>Monto RD$<input type="text" name="monto" inputmode="decimal" required value="${t.montoNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}"></label>
      <label>Día del mes<input type="number" name="dia" min="1" max="31" required value="${dia}"></label>
      <label class="full">Categoría
        <select name="cat">${CATEGORIAS.map((c) => `<option ${c === t.cat ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </label>
    </form>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn btn-primary" data-act="save">Crear gasto fijo</button>
    </div>
  `);
  const form = m.el.querySelector('#convert-form');
  attachMoney(form.monto);
  m.el.querySelector('[data-act="cancel"]').onclick = m.close;
  m.el.querySelector('[data-act="save"]').onclick = async () => {
    try {
      await apiPost('/api/fixed-expenses', {
        concepto: form.concepto.value.trim(),
        monto: moneyToNum(form.monto),
        dia: Number(form.dia.value),
        cat: form.cat.value
      });
      m.close();
      toast('Gasto fijo creado', 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ─── Modo: Por mes ───────────────────────────────────────────

function renderMes(body, viewEl, monthGastos, cardsByKey, budgetsMap, fixedExpAll) {
  const filtered = applyFilters(monthGastos);
  const totalRD = filtered.reduce((a, t) => a + (t.moneda === 'USD$' ? 0 : t.montoNum), 0);
  const totalUSD = filtered.reduce((a, t) => a + (t.moneda === 'USD$' ? t.montoNum : 0), 0);
  body.innerHTML = `
    <div class="card">
      <h2>Gastos del mes
        <span class="muted small">· ${fmtRD(totalRD)}${totalUSD > 0 ? ` + ${fmtMoney(totalUSD, 'USD$')}` : ''}</span>
      </h2>
      ${filterBannerHTML()}
      ${tagFilterBarHTML(monthGastos)}
      ${txTable(filtered, { budgetsMap, cardsByKey, showCicloWarn: true })}
    </div>`;
  bindFilterBanner(body, viewEl);
  bindTagFilterBar(body, viewEl);
  bindTxTable(body, viewEl, filtered, fixedExpAll);
}

// ─── Modo: Por ciclo ─────────────────────────────────────────

async function renderCiclo(body, viewEl, cards, budgetsMap, fixedExpAll) {
  if (cards.length === 0) {
    body.innerHTML = '<div class="card"><p class="empty-state">Registra una tarjeta para ver gastos por ciclo de corte</p></div>';
    return;
  }
  const card = cards.find((c) => c.key === cycleCard) || cards[0];
  const txs = await apiGet(`/api/transactions?ccKey=${encodeURIComponent(card.key)}&cycle=current&kind=gasto`);
  const filtered = applyFilters(txs);
  const total = filtered.reduce((a, t) => a + (t.moneda === 'USD$' ? 0 : t.montoNum), 0);
  body.innerHTML = `
    <div class="card">
      <div class="section-head">
        <h2>Ciclo actual · ${esc(card.label)}</h2>
        <select id="cycle-card-sel" style="max-width:220px">
          ${cards.map((c) => `<option value="${esc(c.key)}" ${c.key === card.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
        </select>
      </div>
      <p class="muted small">Del ${fmtFechaDDMM(card.cicloActual.start)} al ${fmtFechaDDMM(card.cicloActual.end)} (corte día ${card.diaCorte}) · consumos del ciclo: ${fmtRD(total)}</p>
      ${filterBannerHTML()}
      ${tagFilterBarHTML(txs)}
      ${txTable(filtered, { budgetsMap })}
    </div>`;
  body.querySelector('#cycle-card-sel').onchange = (e) => {
    cycleCard = e.target.value;
    render(viewEl);
  };
  bindFilterBanner(body, viewEl);
  bindTagFilterBar(body, viewEl);
  bindTxTable(body, viewEl, filtered, fixedExpAll);
}

// ─── Modo: Gastos fijos ──────────────────────────────────────

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
