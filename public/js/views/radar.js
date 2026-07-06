import { apiGet, apiPost } from '../api.js';
import { esc, toast, confirmDialog } from '../ui.js';
import { fmtRD, currentMonthKey, todayISO } from '../format.js';
import { monthNavHTML, bindMonthNav } from '../monthnav.js';

let month = null;

export async function render(el) {
  if (!month) month = currentMonthKey();
  const data = await apiGet(`/api/radar?month=${month}`);

  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // Día de la semana del 1ro del mes (0=domingo) — cálculo local puro
  const firstDow = new Date(y, m - 1, 1).getDay();
  const hoy = todayISO();

  const byDay = new Map();
  for (const ev of data.events) {
    if (!byDay.has(ev.dia)) byDay.set(ev.dia, []);
    byDay.get(ev.dia).push(ev);
  }

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= data.diasEnMes; d++) {
    const fecha = `${month}-${String(d).padStart(2, '0')}`;
    const events = byDay.get(d) || [];
    cells.push(`
      <div class="cal-cell ${fecha === hoy ? 'today' : ''}">
        <div class="cal-day">${d}</div>
        ${events.map((ev) => {
          const done = ev.estado === 'pagado' || ev.estado === 'recibido';
          const clickable = ev.tipo === 'ingreso_fijo' && !done;
          return `<button class="cal-event ${ev.tipo} ${done ? 'done' : ''} ${clickable ? 'clickable' : ''}"
            ${clickable ? `data-receive="${ev.refId}"` : 'disabled'}
            title="${esc(ev.label)} · ${fmtRD(ev.monto)} · ${ev.estado}">
            ${esc(ev.label)}
          </button>`;
        }).join('')}
      </div>`);
  }

  const totals = { gasto_fijo: 0, ingreso_fijo: 0, pago_tarjeta: 0, cuota_prestamo: 0 };
  for (const ev of data.events) totals[ev.tipo] += ev.monto;

  el.innerHTML = `
    <div class="section-head">
      <h1>📡 Radar financiero</h1>
      ${monthNavHTML(month)}
    </div>

    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Gastos fijos</div><div class="kpi-value">${fmtRD(totals.gasto_fijo)}</div></div>
      <div class="kpi"><div class="kpi-label">Ingresos esperados</div><div class="kpi-value pos">${fmtRD(totals.ingreso_fijo)}</div></div>
      <div class="kpi"><div class="kpi-label">Pagos mínimos tarjetas</div><div class="kpi-value">${fmtRD(totals.pago_tarjeta)}</div></div>
      <div class="kpi"><div class="kpi-label">Cuotas de préstamos</div><div class="kpi-value">${fmtRD(totals.cuota_prestamo)}</div></div>
    </div>

    <div class="card">
      <div class="cal-head">
        ${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => `<div>${d}</div>`).join('')}
      </div>
      <div class="cal-grid">${cells.join('')}</div>
      <div class="legend">
        <span><i style="background:var(--amber)"></i>Gasto fijo</span>
        <span><i style="background:var(--green)"></i>Ingreso fijo (clic para marcar recibido)</span>
        <span><i style="background:var(--purple)"></i>Pago de tarjeta</span>
        <span><i style="background:var(--accent)"></i>Cuota de préstamo</span>
      </div>
    </div>
  `;

  bindMonthNav(el, month, (nuevo) => { month = nuevo; render(el); });

  el.querySelectorAll('[data-receive]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('¿Marcar este ingreso como recibido? Se registrará en Ingresos.', { okLabel: 'Marcar recibido' })) return;
      try {
        await apiPost(`/api/fixed-incomes/${b.dataset.receive}/receive`, { month });
        toast('Ingreso registrado', 'success');
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}
