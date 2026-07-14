import { apiGet, apiPost } from '../api.js';
import { esc, toast, confirmDialog, openModal } from '../ui.js';
import { fmtRD, currentMonthKey, todayISO, monthLabel, addMonthsToKey, addDaysISO, pad2 } from '../format.js';
import { navigate } from '../router.js';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const TYPE_ICON = {
  gasto_fijo: '📌', ingreso_fijo: '💰', pago_tarjeta: '💳',
  corte_tarjeta: '✂️', cuota_tarjeta: '💳', cuota_prestamo: '🏦'
};
const TYPE_LABEL = {
  gasto_fijo: 'Gasto fijo', ingreso_fijo: 'Ingreso esperado', pago_tarjeta: 'Pago de tarjeta',
  corte_tarjeta: 'Corte de tarjeta', cuota_tarjeta: 'Cuota de tarjeta', cuota_prestamo: 'Cuota de préstamo'
};
const TYPE_COLOR = {
  gasto_fijo: 'var(--amber)', ingreso_fijo: 'var(--green)', pago_tarjeta: 'var(--purple)',
  corte_tarjeta: 'var(--muted)', cuota_tarjeta: 'var(--viz-cuotas)', cuota_prestamo: 'var(--accent)'
};
const DEST_LABEL = { gastos: 'Gastos', ingresos: 'Ingresos', tarjetas: 'Tarjetas', prestamos: 'Préstamos' };

let view = 'mes'; // 'mes' | 'semana' | 'hoy'
let month = null;
let day = null;
let lastEvents = [];

function startOfWeekISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return addDaysISO(iso, -dow);
}

function fechaLargaISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES_LARGO[m - 1]} de ${y}`;
}

async function fetchEvents() {
  if (view === 'mes') return apiGet(`/api/radar?month=${month}`);
  if (view === 'semana') {
    const from = startOfWeekISO(day);
    const to = addDaysISO(from, 6);
    return apiGet(`/api/radar?from=${from}&to=${to}`);
  }
  return apiGet(`/api/radar?from=${day}&to=${day}`);
}

function navStep(delta) {
  if (view === 'mes') month = addMonthsToKey(month, delta);
  else if (view === 'semana') day = addDaysISO(day, delta * 7);
  else day = addDaysISO(day, delta);
}

export async function render(el) {
  if (!month) month = currentMonthKey();
  if (!day) day = todayISO();

  const data = await fetchEvents();
  lastEvents = data.events;

  let title = '';
  let bodyHTML = '';
  if (view === 'mes') {
    title = monthLabel(month);
    bodyHTML = renderMes(data);
  } else if (view === 'semana') {
    const from = startOfWeekISO(day);
    const to = addDaysISO(from, 6);
    title = `${Number(from.slice(8, 10))}–${Number(to.slice(8, 10))} ${monthLabel(to.slice(0, 7))}`;
    bodyHTML = renderSemana(data, from);
  } else {
    title = fechaLargaISO(day);
    bodyHTML = renderHoy(data);
  }

  el.innerHTML = `
    <div class="section-head"><h1>📡 Radar financiero</h1></div>
    <div class="radar-toolbar">
      <div class="tabs" style="margin:0">
        <button type="button" data-view="mes" class="${view === 'mes' ? 'active' : ''}">Mes</button>
        <button type="button" data-view="semana" class="${view === 'semana' ? 'active' : ''}">Semana</button>
        <button type="button" data-view="hoy" class="${view === 'hoy' ? 'active' : ''}">Hoy</button>
      </div>
      <button class="btn btn-ghost btn-sm" id="radar-prev">‹</button>
      <span class="radar-title">${esc(title)}</span>
      <button class="btn btn-ghost btn-sm" id="radar-next">›</button>
      <button class="btn btn-ghost btn-sm" id="radar-today">📍 Hoy</button>
      <div class="legend radar-legend">
        <span><i style="background:var(--amber)"></i>Gasto fijo</span>
        <span><i style="background:var(--green)"></i>Ingreso fijo</span>
        <span><i style="background:var(--purple)"></i>Pago tarjeta</span>
        <span><i style="background:var(--muted)"></i>Corte tarjeta</span>
        <span><i style="background:var(--viz-cuotas)"></i>Cuota tarjeta</span>
        <span><i style="background:var(--accent)"></i>Cuota préstamo</span>
      </div>
    </div>

    ${kpisHTML(data.events)}

    <div class="card" id="radar-body">${bodyHTML}</div>
  `;

  el.querySelectorAll('[data-view]').forEach((btn) => {
    btn.onclick = () => {
      view = btn.dataset.view;
      if (view === 'hoy') day = todayISO();
      render(el);
    };
  });
  el.querySelector('#radar-prev').onclick = () => { navStep(-1); render(el); };
  el.querySelector('#radar-next').onclick = () => { navStep(1); render(el); };
  el.querySelector('#radar-today').onclick = () => { month = currentMonthKey(); day = todayISO(); render(el); };

  el.querySelectorAll('[data-ev-idx]').forEach((btn) => {
    btn.onclick = () => openEventPopover(el, lastEvents[Number(btn.dataset.evIdx)]);
  });
  el.querySelectorAll('[data-goto-day]').forEach((btn) => {
    btn.onclick = () => { view = 'hoy'; day = btn.dataset.gotoDay; render(el); };
  });
}

// ─── KPIs ────────────────────────────────────────────────────

function kpisHTML(events) {
  const totals = {};
  for (const ev of events) {
    if (ev.monto == null) continue;
    totals[ev.tipo] = (totals[ev.tipo] || 0) + ev.monto;
  }
  return `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Gastos fijos</div><div class="kpi-value">${fmtRD(totals.gasto_fijo || 0)}</div></div>
      <div class="kpi"><div class="kpi-label">Ingresos esperados</div><div class="kpi-value pos">${fmtRD(totals.ingreso_fijo || 0)}</div></div>
      <div class="kpi"><div class="kpi-label">Pagos de tarjetas</div><div class="kpi-value">${fmtRD(totals.pago_tarjeta || 0)}</div></div>
      <div class="kpi"><div class="kpi-label">Cuotas de tarjeta</div><div class="kpi-value">${fmtRD(totals.cuota_tarjeta || 0)}</div></div>
      <div class="kpi"><div class="kpi-label">Cuotas de préstamos</div><div class="kpi-value">${fmtRD(totals.cuota_prestamo || 0)}</div></div>
    </div>`;
}

// ─── Vista Mes ───────────────────────────────────────────────

function eventPillHTML(ev, idx) {
  const done = ev.estado === 'pagado' || ev.estado === 'recibido';
  const icon = ev.tipo === 'ingreso_fijo' && ev.estado === 'recibido' ? '✅' : (TYPE_ICON[ev.tipo] || '📌');
  return `<button type="button" class="cal-event ${ev.tipo} ${done ? 'done' : ''}" data-ev-idx="${idx}" title="${esc(ev.label)}">
    ${icon} ${esc(ev.label)}
  </button>`;
}

function renderMes(data) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const firstDow = new Date(y, m - 1, 1).getDay();
  const diasEnMes = Number(data.to.slice(8, 10));
  const hoy = todayISO();

  const byDay = new Map();
  data.events.forEach((ev, idx) => {
    const d = Number(ev.fecha.slice(8, 10));
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(idx);
  });

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= diasEnMes; d++) {
    const fecha = `${month}-${pad2(d)}`;
    const idxs = byDay.get(d) || [];
    const shown = idxs.slice(0, 2);
    const resto = idxs.length - shown.length;
    cells.push(`
      <div class="cal-cell ${fecha === hoy ? 'today' : ''}">
        <div class="cal-day">${d}</div>
        ${shown.map((idx) => eventPillHTML(data.events[idx], idx)).join('')}
        ${resto > 0 ? `<button type="button" class="cal-more" data-goto-day="${fecha}">+${resto} más</button>` : ''}
      </div>`);
  }
  const rem = (firstDow + diasEnMes) % 7;
  if (rem > 0) for (let i = 0; i < 7 - rem; i++) cells.push('<div class="cal-cell empty"></div>');

  return `
    <div class="cal-head">${DAYS.map((d) => `<div>${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>`;
}

// ─── Vista Semana ────────────────────────────────────────────

function weekEventHTML(ev, idx) {
  const done = ev.estado === 'pagado' || ev.estado === 'recibido';
  const icon = ev.tipo === 'ingreso_fijo' && ev.estado === 'recibido' ? '✅' : (TYPE_ICON[ev.tipo] || '📌');
  return `<button type="button" class="cal-event rweek-event ${ev.tipo} ${done ? 'done' : ''}" data-ev-idx="${idx}">
    ${icon} ${esc(ev.label)}
    ${ev.monto != null ? `<div class="rweek-amount">${fmtRD(ev.monto)}</div>` : ''}
  </button>`;
}

function renderSemana(data, from) {
  const hoy = todayISO();
  const byDay = new Map();
  data.events.forEach((ev, idx) => {
    if (!byDay.has(ev.fecha)) byDay.set(ev.fecha, []);
    byDay.get(ev.fecha).push(idx);
  });

  let cols = '';
  for (let i = 0; i < 7; i++) {
    const fecha = addDaysISO(from, i);
    const idxs = byDay.get(fecha) || [];
    const isToday = fecha === hoy;
    cols += `
      <div class="rweek-col ${isToday ? 'today' : ''}">
        <div class="rweek-dayname">${DAYS[i]}</div>
        <div class="rweek-daynum">${Number(fecha.slice(8, 10))}</div>
        <div class="rweek-events">
          ${idxs.length === 0
            ? '<p class="muted small" style="opacity:.6">Sin eventos</p>'
            : idxs.map((idx) => weekEventHTML(data.events[idx], idx)).join('')}
        </div>
      </div>`;
  }
  return `<div class="rweek-grid">${cols}</div>`;
}

// ─── Vista Hoy (agenda) ──────────────────────────────────────

function agendaItemHTML(ev, idx) {
  const col = TYPE_COLOR[ev.tipo] || 'var(--muted)';
  const isIncome = ev.tipo === 'ingreso_fijo';
  const done = ev.estado === 'pagado' || ev.estado === 'recibido';
  const icon = isIncome && ev.estado === 'recibido' ? '✅' : (TYPE_ICON[ev.tipo] || '📌');
  return `
    <div class="ragenda-item" data-ev-idx="${idx}" style="border-left:3px solid ${col}">
      <div class="ragenda-icon" style="background:${col}22">${icon}</div>
      <div class="ragenda-info">
        <div class="ragenda-label ${done ? 'done' : ''}">${esc(ev.label)}</div>
        <div class="muted small">${esc(TYPE_LABEL[ev.tipo] || '')}${ev.detalle ? ' · ' + esc(ev.detalle) : ''}</div>
      </div>
      ${ev.monto != null ? `<div class="ragenda-amount" style="color:${isIncome ? 'var(--green)' : col}">${isIncome ? '+' : '−'}${fmtRD(ev.monto)}</div>` : ''}
    </div>`;
}

function renderHoy(data) {
  if (data.events.length === 0) {
    return '<p class="empty-state" style="padding:3rem 1rem">✅ Sin compromisos este día</p>';
  }
  const total = data.events.reduce((s, ev) => s + (ev.tipo !== 'ingreso_fijo' && ev.monto ? ev.monto : 0), 0);
  return `
    <p class="muted small" style="border-bottom:1px solid var(--border);padding-bottom:0.6rem;margin-bottom:0.4rem">
      ${data.events.length} evento${data.events.length !== 1 ? 's' : ''} · Total: <strong>${fmtRD(total)}</strong>
    </p>
    <div class="ragenda">
      ${data.events.map((ev, idx) => agendaItemHTML(ev, idx)).join('')}
    </div>`;
}

// ─── Popover de evento ───────────────────────────────────────

function openEventPopover(viewEl, ev) {
  const col = TYPE_COLOR[ev.tipo] || 'var(--muted)';
  const isIncome = ev.tipo === 'ingreso_fijo';
  const done = ev.estado === 'pagado' || ev.estado === 'recibido';
  const icon = isIncome && ev.estado === 'recibido' ? '✅' : (TYPE_ICON[ev.tipo] || '📌');

  const m = openModal(`
    <div style="text-align:center">
      <div style="font-size:2rem">${icon}</div>
      <h2 style="margin:0.3rem 0">${esc(ev.label)}</h2>
      <div class="small" style="color:${col}">${esc(TYPE_LABEL[ev.tipo] || '')}</div>
    </div>
    ${ev.detalle ? `<p class="muted small" style="text-align:center;margin-top:0.6rem">${esc(ev.detalle)}</p>` : ''}
    ${ev.monto != null ? `<div style="text-align:center;font-size:1.4rem;font-weight:700;color:${isIncome ? 'var(--green)' : col};margin-top:0.5rem">
      ${isIncome ? '+' : '−'}${fmtRD(ev.monto)}
    </div>` : ''}
    ${done ? `<div class="pos small" style="text-align:center;margin-top:0.3rem">✓ ${ev.estado === 'pagado' ? 'Pagado' : 'Recibido'}</div>` : ''}
    <div class="modal-actions" style="justify-content:center;flex-wrap:wrap">
      ${isIncome && !done ? '<button class="btn btn-success" data-act="recibir">✓ Marcar como recibido</button>' : ''}
      <button class="btn btn-primary" data-act="ir">Ir a ${DEST_LABEL[ev.dest] || 'módulo'} →</button>
      <button class="btn" data-act="cerrar">Cerrar</button>
    </div>
  `);

  m.el.querySelector('[data-act="cerrar"]').onclick = m.close;
  m.el.querySelector('[data-act="ir"]').onclick = () => { m.close(); navigate(ev.dest || 'dashboard'); };

  const recibirBtn = m.el.querySelector('[data-act="recibir"]');
  if (recibirBtn) {
    recibirBtn.onclick = async () => {
      m.close();
      if (!await confirmDialog('¿Marcar este ingreso como recibido? Se registrará en Ingresos.', { okLabel: 'Marcar recibido' })) return;
      try {
        await apiPost(`/api/fixed-incomes/${ev.refId}/receive`, { month: ev.fecha.slice(0, 7) });
        toast('Ingreso registrado', 'success');
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
}
