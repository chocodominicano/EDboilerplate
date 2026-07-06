import { apiGet } from '../api.js';
import { esc, progressBar, overLimitBadge } from '../ui.js';
import { fmtRD, fmtMoney, fmtFechaDDMM, currentMonthKey, monthLabel } from '../format.js';
import { monthNavHTML, bindMonthNav } from '../monthnav.js';

let month = null;

export async function render(el) {
  if (!month) month = currentMonthKey();
  const d = await apiGet(`/api/dashboard?month=${month}`);
  const k = d.kpis;
  const dd = d.deudas;

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
}
