import { apiGet } from '../api.js';
import { esc, progressBar, overLimitBadge } from '../ui.js';
import { fmtRD, fmtMoney, fmtFechaDDMM, currentMonthKey, monthLabel } from '../format.js';
import { monthNavHTML, bindMonthNav } from '../monthnav.js';
import { navigate } from '../router.js';

let month = null;

const VIZ_COLORS = {
  tarjetas: 'var(--viz-tarjetas)',
  cuotas: 'var(--viz-cuotas)',
  gastosFijos: 'var(--viz-fijos)',
  prestamos: 'var(--viz-prestamos)'
};

// Visual consolidada: barra apilada parte-del-todo (orden fijo
// tarjetas→cuotas→fijos→préstamos) + leyenda con montos + desglose por ítem
function debtBreakdown(dd) {
  const cats = dd.porCategoria || [];
  const total = dd.totalConsolidadoRD || 0;
  if (total <= 0) {
    return '<p class="empty-state" style="margin-top:0.75rem">🎉 Sin deudas ni compromisos pendientes este mes</p>';
  }

  const pctOf = (v) => (v / total) * 100;
  const maxItem = Math.max(1, ...cats.flatMap((c) => c.items.map((i) => i.monto)));

  const stack = cats.filter((c) => c.total > 0).map((c) => `
    <div class="debt-seg" style="flex:${pctOf(c.total)};background:${VIZ_COLORS[c.key]}"
         role="img" aria-label="${esc(c.label)}: ${fmtRD(c.total)} (${pctOf(c.total).toFixed(1)}%)">
      <span class="debt-tip">${esc(c.label)} · <strong>${fmtRD(c.total)}</strong> · ${pctOf(c.total).toFixed(1)}%</span>
    </div>`).join('');

  const legend = cats.map((c) => `
    <span class="${c.total > 0 ? '' : 'muted'}">
      <i class="chipbox" style="background:${VIZ_COLORS[c.key]}"></i>${esc(c.label)}
      <strong>${fmtRD(c.total)}</strong> <span class="muted">(${pctOf(c.total).toFixed(1)}%)</span>
    </span>`).join('');

  const catBlocks = cats.map((c) => {
    const items = c.items.slice().sort((a, b) => b.monto - a.monto);
    const shown = items.slice(0, 5);
    const resto = items.length - shown.length;
    return `
      <div class="debt-cat">
        <div class="debt-cat-head">
          <span><i class="chipbox" style="background:${VIZ_COLORS[c.key]}"></i><strong>${esc(c.label)}</strong></span>
          <span class="muted small">${fmtRD(c.total)}</span>
        </div>
        ${items.length === 0 ? '<p class="muted small">Sin pendientes</p>' : shown.map((i) => `
          <div class="debt-item">
            <span>${esc(i.label)}${i.estado === 'vencido' ? ' <span class="badge badge-danger">vencido</span>' : ''}</span>
            <span class="right">${fmtRD(i.monto)}</span>
            <span class="bar"><i style="width:${Math.max(2, (i.monto / maxItem) * 100)}%;background:${VIZ_COLORS[c.key]}"></i></span>
          </div>`).join('')}
        ${resto > 0 ? `<p class="muted small" style="margin-top:0.35rem">+${resto} más</p>` : ''}
      </div>`;
  }).join('');

  return `
    <div style="margin-top:1.1rem">
      <h3>Deudas consolidadas por categoría
        <span class="muted small">· total ${fmtRD(total)} (incluye gastos fijos sin pagar del mes)</span>
      </h3>
      <div class="debt-stack">${stack}</div>
      <div class="debt-legend">${legend}</div>
      <div class="debt-cats">${catBlocks}</div>
    </div>`;
}

export async function render(el) {
  if (!month) month = currentMonthKey();
  const [d, goals] = await Promise.all([
    apiGet(`/api/dashboard?month=${month}`),
    apiGet('/api/goals').catch(() => [])
  ]);
  const k = d.kpis;
  const dd = d.deudas;
  const hayMetaActiva = goals.some((g) => g.activo && !g.completada);

  el.innerHTML = `
    <div class="section-head">
      <h1>Dashboard</h1>
      ${monthNavHTML(month)}
    </div>

    <div class="kpis">
      <div class="kpi">
        <div class="kpi-label">Balance del mes</div>
        <div class="kpi-value ${k.balance >= 0 ? 'pos' : 'neg'}">${fmtRD(k.balance)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Ingresos</div>
        <div class="kpi-value pos">${fmtRD(k.ingresos)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Gastos</div>
        <div class="kpi-value neg">${fmtRD(k.gastos)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Transacciones</div>
        <div class="kpi-value">${k.txCount}</div>
        <div class="kpi-sub">${esc(monthLabel(d.month))}</div>
      </div>
    </div>

    ${k.balance > 0 && hayMetaActiva ? `
    <div class="card" style="border-color:var(--accent);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.6rem">
      <span>💰 Tienes ${fmtRD(k.balance)} disponible este mes.</span>
      <button class="btn btn-primary btn-sm" id="banner-metas">🎯 Asignar a meta</button>
    </div>` : ''}

    <div class="card">
      <h2>🧾 Resumen de todas mis deudas</h2>
      <div class="kpis" style="margin-bottom:0">
        <div class="kpi">
          <div class="kpi-label">Deuda total</div>
          <div class="kpi-value neg">${fmtRD(dd.totalDeudaRD)}</div>
          <div class="kpi-sub">${dd.tarjetas} tarjeta(s) · ${dd.prestamos} préstamo(s)</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Tarjetas de crédito</div>
          <div class="kpi-value">${fmtRD(dd.deudaTarjetasRD)}</div>
          <div class="kpi-sub">Uso global ${dd.usoGlobalPct}% ${overLimitBadge(dd.usoGlobalPct)}</div>
          ${progressBar(dd.usoGlobalPct)}
        </div>
        <div class="kpi">
          <div class="kpi-label">Préstamos</div>
          <div class="kpi-value">${fmtRD(dd.deudaPrestamosRD)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Pago mínimo mensual</div>
          <div class="kpi-value">${fmtRD(dd.pagoMinimoTotal)}</div>
          <div class="kpi-sub">mínimos de tarjetas + cuotas de préstamos</div>
        </div>
      </div>
      ${debtBreakdown(dd)}
    </div>

    <div class="split-2">
      <div class="card">
        <h2>Quincenas</h2>
        <table>
          <thead><tr><th></th><th class="right">Ingresos</th><th class="right">Gastos</th><th class="right">Balance</th></tr></thead>
          <tbody>
            ${[1, 2].map((q) => {
              const qq = d.quincenas[`q${q}`];
              const bal = qq.ingresos - qq.gastos;
              return `<tr>
                <td><span class="badge badge-q${q}">Q${q}</span> <span class="muted small">${q === 1 ? 'días 1–15' : 'días 16–fin'}</span></td>
                <td class="right pos">${fmtRD(qq.ingresos)}</td>
                <td class="right neg">${fmtRD(qq.gastos)}</td>
                <td class="right ${bal >= 0 ? 'pos' : 'neg'}">${fmtRD(bal)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Últimas transacciones</h2>
        ${d.ultimas5.length === 0 ? '<p class="empty-state">Sin transacciones todavía</p>' : `
        <div class="table-wrap"><table>
          <tbody>
            ${d.ultimas5.map((t) => `
              <tr>
                <td class="muted">${fmtFechaDDMM(t.fechaSort)}</td>
                <td>${esc(t.nombre)}${t.isPagoTarjeta ? ' <span class="badge badge-muted">transferencia</span>' : ''}</td>
                <td class="muted">${esc(t.cat || '')}</td>
                <td class="right ${t.isPagoTarjeta ? 'muted' : (t.neg ? 'neg' : 'pos')}">
                  ${t.neg ? '−' : '+'}${fmtMoney(t.montoNum, t.moneda)}
                </td>
              </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    </div>
  `;

  bindMonthNav(el, month, (nuevo) => {
    month = nuevo;
    render(el);
  });

  el.querySelector('#banner-metas')?.addEventListener('click', () => navigate('metas'));
}
