import { apiGet, apiDownload } from '../api.js';
import { esc, toast, progressBar, overLimitBadge } from '../ui.js';
import { fmtRD, fmtUSD, fmtMoney, fmtFechaDDMM, currentMonthKey, addMonthsToKey, monthLabel } from '../format.js';
import { attachMoney, moneyToNum, moneyStr } from '../money.js';
import { navigate } from '../router.js';
import { ACCENT_COLORS } from '../colors.js';

let tab = 'mensual';
let month = null;
let year = null;
let horizonte = 6;
let escenario = 'base';
let proySupuestos = { ingreso: '', gasto: '', extra: '' };
let peLoanFilter = 'all';

const TIPO_ICON = { urgente: '🚨', importante: '⚠️', atencion: '👀', optimizar: '🎯', ahorro: '✅' };
const SALUD_COLOR = { excelente: 'var(--green)', buena: 'var(--accent)', atencion: 'var(--amber)', critica: 'var(--red)' };

export async function render(el) {
  if (!month) month = currentMonthKey();
  if (!year) year = Number(currentMonthKey().slice(0, 4));

  el.innerHTML = `
    <div class="section-head">
      <h1>Reportes</h1>
    </div>
    <div class="card" style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:1rem">
      <select id="rep-period">${periodOptions(month)}</select>
      <button class="btn btn-ghost btn-sm" id="rep-export-pdf">↓ PDF</button>
      <button class="btn btn-ghost btn-sm" id="rep-export-excel">↓ Excel</button>
    </div>
    <div class="tabs">
      <button data-tab="mensual" class="${tab === 'mensual' ? 'active' : ''}">Mensual</button>
      <button data-tab="anual" class="${tab === 'anual' ? 'active' : ''}">Anual</button>
      <button data-tab="proyeccion" class="${tab === 'proyeccion' ? 'active' : ''}">Proyección</button>
      <button data-tab="pagosextra" class="${tab === 'pagosextra' ? 'active' : ''}">Pagos extra</button>
      <button data-tab="cuotas" class="${tab === 'cuotas' ? 'active' : ''}">Cuotas</button>
      <button data-tab="tarjetas" class="${tab === 'tarjetas' ? 'active' : ''}">💳 Tarjetas</button>
    </div>
    <div id="rep-body"><p class="muted">Cargando…</p></div>
  `;

  el.querySelector('#rep-period').onchange = (e) => { month = e.target.value; render(el); };
  el.querySelector('#rep-export-pdf').onclick = () => doExport('pdf', 'pdf');
  el.querySelector('#rep-export-excel').onclick = () => doExport('excel', 'xlsx');
  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { tab = b.dataset.tab; render(el); };
  });

  const body = el.querySelector('#rep-body');
  if (tab === 'mensual') await renderMensual(body, el);
  else if (tab === 'anual') await renderAnual(body, el);
  else if (tab === 'proyeccion') await renderProyeccion(body, el);
  else if (tab === 'pagosextra') await renderPagosExtra(body, el);
  else if (tab === 'cuotas') await renderCuotas(body, el);
  else await renderTarjetas(body, el);
}

async function doExport(kind, ext) {
  try {
    toast(`Generando ${ext.toUpperCase()}…`, 'info');
    await apiDownload(`/api/reports/export/${kind}?month=${month}`, `reporte-financiero-${month}.${ext}`);
    toast(`✓ ${ext.toUpperCase()} descargado`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function periodOptions(sel) {
  let out = '';
  for (let i = 0; i < 12; i++) {
    const mk = addMonthsToKey(currentMonthKey(), -i);
    out += `<option value="${mk}" ${mk === sel ? 'selected' : ''}>${monthLabel(mk)}</option>`;
  }
  return out;
}

function yearOptions(sel) {
  const cur = Number(currentMonthKey().slice(0, 4));
  return [cur - 2, cur - 1, cur, cur + 1]
    .map((y) => `<option value="${y}" ${y === sel ? 'selected' : ''}>${y}</option>`).join('');
}

function barListHTML(items, keyField) {
  if (!items.length) return '<p class="empty-state">Sin datos este período</p>';
  const max = Math.max(...items.map((i) => i.total), 1);
  return items.map((it, i) => `
    <div class="debt-item">
      <span>${esc(it[keyField])}</span>
      <span class="right">${fmtRD(it.total)}</span>
      <span class="bar"><i style="width:${Math.max(2, (it.total / max) * 100)}%;background:${ACCENT_COLORS[i % ACCENT_COLORS.length]}"></i></span>
    </div>`).join('');
}

function miniBarChartHTML(points, labelKey, valueKey, color) {
  const max = Math.max(...points.map((p) => p[valueKey]), 1);
  return `
    <div style="display:flex;gap:0.25rem;height:44px">
      ${points.map((p) => {
        const h = Math.max(3, Math.round((p[valueKey] / max) * 100));
        return `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
          <div style="width:100%;background:${color};border-radius:3px 3px 0 0;height:${h}%;min-height:3px;opacity:0.85"
            title="${esc(monthLabel(p[labelKey]))}: ${fmtRD(p[valueKey])}"></div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:0.25rem;margin-top:0.2rem">
      ${points.map((p) => `<div style="flex:1;text-align:center;font-size:0.65rem;color:var(--muted)">${monthLabel(p[labelKey]).slice(0, 3)}</div>`).join('')}
    </div>`;
}

function recoHTML(reco) {
  const color = SALUD_COLOR[reco.salud] || 'var(--muted)';
  return `
    <div class="card" style="border-left:3px solid ${color}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap">
        <h2 style="margin:0">🧭 Asesor financiero</h2>
        <span class="badge" style="background:${color}22;border:1px solid ${color}44;color:${color};text-transform:capitalize">${reco.salud}</span>
      </div>
      <p class="muted" style="margin:0.4rem 0 0.75rem">${esc(reco.mensajeGeneral)}</p>
      ${reco.recomendaciones.length === 0 ? '' : `
      <div style="display:flex;flex-direction:column;gap:0.5rem">
        ${reco.recomendaciones.map((r) => `
          <div style="display:flex;gap:0.6rem;align-items:flex-start;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:0.6rem 0.75rem">
            <span style="font-size:1.1rem">${TIPO_ICON[r.tipo] || '•'}</span>
            <div>
              <div style="font-weight:600;font-size:0.9rem">${esc(r.titulo)}</div>
              <div class="small muted">${esc(r.descripcion)}</div>
            </div>
          </div>`).join('')}
      </div>`}
    </div>`;
}

// ─── Tab Mensual ────────────────────────────────────────────────────

async function renderMensual(body, viewEl) {
  const [data, reco, loans, cards] = await Promise.all([
    apiGet(`/api/reports/mensual?month=${month}`),
    apiGet('/api/reports/recomendaciones').catch(() => null),
    apiGet('/api/loans'),
    apiGet('/api/cards')
  ]);

  const k = data.kpis;
  const va = data.vsAnterior;
  const diffTxt = (d, positivoEsVerde) => {
    const bien = positivoEsVerde ? d.diff >= 0 : d.diff <= 0;
    const arrow = d.diff >= 0 ? '↑' : '↓';
    return `<span class="${bien ? 'pos' : 'neg'}">${arrow} ${d.diff >= 0 ? '+' : ''}${fmtRD(Math.abs(d.diff))} vs ${monthLabel(va.prevMonth)}</span>`;
  };

  const totalAdeudado = round2(loans.reduce((a, l) => a + l.saldoPendiente, 0));
  const cuotaTotal = round2(loans.reduce((a, l) => a + (l.saldoPendiente > 0 ? l.cuotaMensual : 0), 0));
  const capitalPagado = round2(loans.reduce((a, l) => a + (l.original - l.saldoPendiente), 0));
  const interesPagado = round2(loans.reduce((a, l) => a + l.interesPagado, 0));
  const deudaTarjetas = round2(cards.reduce((a, c) => a + c.deudaTotalRD, 0));
  const limiteTarjetas = round2(cards.reduce((a, c) => a + c.limitRD, 0));
  const usoGlobal = limiteTarjetas > 0 ? round2((deudaTarjetas / limiteTarjetas) * 100) : 0;

  body.innerHTML = `
    ${reco ? recoHTML(reco) : ''}
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Ingresos</div><div class="kpi-value pos">${fmtRD(k.ingresos)}</div><div class="kpi-sub">${diffTxt(va.ingresos, true)}</div></div>
      <div class="kpi"><div class="kpi-label">Gastos</div><div class="kpi-value neg">${fmtRD(k.gastos)}</div><div class="kpi-sub">${diffTxt(va.gastos, false)}</div></div>
      <div class="kpi"><div class="kpi-label">Balance</div><div class="kpi-value ${k.balance >= 0 ? 'pos' : 'neg'}">${fmtRD(k.balance)}</div><div class="kpi-sub">Tasa de ahorro ${k.ahorroPct}%</div></div>
      <div class="kpi"><div class="kpi-label">Gasto diario prom.</div><div class="kpi-value">${fmtRD(k.gastoDiarioProm)}</div></div>
      <div class="kpi"><div class="kpi-label">Gastos en USD$</div><div class="kpi-value">${fmtUSD(k.gastosUSD)}</div><div class="kpi-sub">≈ ${fmtRD(k.gastosUSDenRD)}</div></div>
      <div class="kpi"><div class="kpi-label">Último ingreso</div><div class="kpi-value">${data.ultimoIngreso ? fmtMoney(data.ultimoIngreso.montoNum, data.ultimoIngreso.moneda) : '—'}</div><div class="kpi-sub">${data.ultimoIngreso ? fmtFechaDDMM(data.ultimoIngreso.fechaSort) : ''}</div></div>
    </div>

    <div class="split-2">
      <div class="card">
        <h2>Top categorías de gasto</h2>
        ${barListHTML(data.porCategoria, 'cat')}
      </div>
      <div class="card">
        <h2>Gasto por método de pago</h2>
        ${barListHTML(data.porMetodo, 'metodo')}
      </div>
    </div>

    ${data.presupuesto.length ? `
    <div class="card">
      <h2>Presupuesto vs gastado</h2>
      ${data.presupuesto.map((b) => `
        <div style="margin-bottom:0.6rem">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem">
            <span>${esc(b.cat)}</span><span>${fmtRD(b.gastado)} / ${fmtRD(b.limite)} ${overLimitBadge(b.pct)}</span>
          </div>
          ${progressBar(b.pct)}
        </div>`).join('')}
    </div>` : ''}

    <div class="split-2">
      <div class="card">
        <h2>Préstamos</h2>
        <div class="kpis" style="margin-bottom:0.75rem">
          <div class="kpi"><div class="kpi-label">Total adeudado</div><div class="kpi-value neg">${fmtRD(totalAdeudado)}</div></div>
          <div class="kpi"><div class="kpi-label">Cuota mensual</div><div class="kpi-value">${fmtRD(cuotaTotal)}</div></div>
          <div class="kpi"><div class="kpi-label">Capital pagado</div><div class="kpi-value pos">${fmtRD(capitalPagado)}</div></div>
          <div class="kpi"><div class="kpi-label">Interés pagado</div><div class="kpi-value">${fmtRD(interesPagado)}</div></div>
        </div>
        ${totalAdeudado > 0 ? `<div class="muted small" style="margin-bottom:0.3rem">Saldo pendiente — últimos 6 meses</div>${miniBarChartHTML(data.prestamosEvolucion, 'mesKey', 'saldoTotal', 'var(--viz-prestamos)')}` : '<p class="empty-state">Sin préstamos activos</p>'}
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">Tarjetas</h2>
          ${cards.length ? '<button class="btn btn-ghost btn-sm" id="rep-ver-tarjetas">Ver salud crediticia →</button>' : ''}
        </div>
        <div class="kpis" style="margin:0.75rem 0 0">
          <div class="kpi"><div class="kpi-label">Deuda total</div><div class="kpi-value neg">${fmtRD(deudaTarjetas)}</div></div>
          <div class="kpi"><div class="kpi-label">Uso global</div><div class="kpi-value">${usoGlobal}%${overLimitBadge(usoGlobal)}</div>${progressBar(usoGlobal)}</div>
        </div>
        ${cards.length === 0 ? '<p class="empty-state">Sin tarjetas registradas</p>' : ''}
      </div>
    </div>
  `;
  body.querySelector('#rep-ver-tarjetas')?.addEventListener('click', () => navigate('tarjetas'));
}

// ─── Tab Anual ──────────────────────────────────────────────────────

async function renderAnual(body, viewEl) {
  const data = await apiGet(`/api/reports/anual?year=${year}`);
  const maxVal = Math.max(...data.meses.map((m) => Math.max(m.ingresos, m.gastos)), 1);

  body.innerHTML = `
    <div style="margin-bottom:1rem">
      <select id="rep-year">${yearOptions(year)}</select>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Ingresos del año</div><div class="kpi-value pos">${fmtRD(data.totales.ingresos)}</div></div>
      <div class="kpi"><div class="kpi-label">Gastos del año</div><div class="kpi-value neg">${fmtRD(data.totales.gastos)}</div></div>
      <div class="kpi"><div class="kpi-label">Balance anual</div><div class="kpi-value ${data.totales.balance >= 0 ? 'pos' : 'neg'}">${fmtRD(data.totales.balance)}</div></div>
      <div class="kpi"><div class="kpi-label">Mejor mes</div><div class="kpi-value">${data.mejorMes && data.mejorMes.conDatos ? monthLabel(data.mejorMes.mesKey) : '—'}</div></div>
    </div>

    <div class="card">
      <h2>Ingresos vs gastos por mes</h2>
      <div style="display:flex;gap:0.4rem;height:140px;align-items:flex-end">
        ${data.meses.map((m) => `
          <div style="flex:1;display:flex;gap:2px;align-items:flex-end;height:100%;justify-content:center">
            <div style="width:45%;background:var(--green);border-radius:2px 2px 0 0;height:${Math.max(2, (m.ingresos / maxVal) * 100)}%" title="Ingresos: ${fmtRD(m.ingresos)}"></div>
            <div style="width:45%;background:var(--red);border-radius:2px 2px 0 0;height:${Math.max(2, (m.gastos / maxVal) * 100)}%" title="Gastos: ${fmtRD(m.gastos)}"></div>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:0.4rem;margin-top:0.3rem">
        ${data.meses.map((m) => `<div style="flex:1;text-align:center;font-size:0.65rem;color:var(--muted)">${monthLabel(m.mesKey).slice(0, 3)}</div>`).join('')}
      </div>
    </div>

    <div class="card">
      <h2>Detalle mensual</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Mes</th><th class="right">Ingresos</th><th class="right">Gastos</th><th class="right">Balance</th><th class="right">Ahorro %</th><th class="right">Txs</th></tr></thead>
        <tbody>
          ${data.meses.map((m) => `<tr style="${m.conDatos ? '' : 'opacity:.35'}">
            <td>${monthLabel(m.mesKey)}</td>
            <td class="right pos">${fmtRD(m.ingresos)}</td>
            <td class="right neg">${fmtRD(m.gastos)}</td>
            <td class="right ${m.balance >= 0 ? 'pos' : 'neg'}">${fmtRD(m.balance)}</td>
            <td class="right">${m.ahorroPct}%</td>
            <td class="right">${m.txCount}</td>
          </tr>`).join('')}
          <tr style="border-top:2px solid var(--accent);font-weight:700">
            <td>Total</td>
            <td class="right pos">${fmtRD(data.totales.ingresos)}</td>
            <td class="right neg">${fmtRD(data.totales.gastos)}</td>
            <td class="right ${data.totales.balance >= 0 ? 'pos' : 'neg'}">${fmtRD(data.totales.balance)}</td>
            <td></td><td></td>
          </tr>
        </tbody>
      </table></div>
    </div>
  `;
  body.querySelector('#rep-year').onchange = (e) => { year = Number(e.target.value); renderAnual(body, viewEl); };
}

// ─── Tab Proyección ─────────────────────────────────────────────────

async function renderProyeccion(body, viewEl) {
  const params = new URLSearchParams({ horizonte: String(horizonte), escenario });
  if (proySupuestos.ingreso) params.set('ingreso', String(moneyToNum(proySupuestos.ingreso)));
  if (proySupuestos.gasto) params.set('gasto', String(moneyToNum(proySupuestos.gasto)));
  if (proySupuestos.extra) params.set('extra', String(moneyToNum(proySupuestos.extra)));
  const data = await apiGet(`/api/reports/proyeccion?${params}`);

  const maxBal = Math.max(...data.meses.map((m) => Math.abs(m.balance)), 1);
  const maxDeuda = Math.max(...data.meses.map((m) => m.deuda), 1);
  const deudaItems = [
    ...data.deudaDesglose.prestamos.map((p) => ({ label: p.nombre, total: p.saldoActual })),
    ...(data.deudaDesglose.tarjetasTotal > 0 ? [{ label: 'Tarjetas de crédito', total: data.deudaDesglose.tarjetasTotal }] : [])
  ];
  const maxDeudaItem = Math.max(...deudaItems.map((i) => i.total), 1);

  body.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:flex-end">
        <label>Horizonte<br><select id="proy-horizonte">
          <option value="3" ${horizonte === 3 ? 'selected' : ''}>3 meses</option>
          <option value="6" ${horizonte === 6 ? 'selected' : ''}>6 meses</option>
          <option value="12" ${horizonte === 12 ? 'selected' : ''}>12 meses</option>
        </select></label>
        <label>Escenario<br><select id="proy-escenario">
          <option value="base" ${escenario === 'base' ? 'selected' : ''}>Base (actual)</option>
          <option value="optimista" ${escenario === 'optimista' ? 'selected' : ''}>Optimista +10%</option>
          <option value="pesimista" ${escenario === 'pesimista' ? 'selected' : ''}>Pesimista -10%</option>
        </select></label>
        <label>Ingreso mensual<br><input type="text" id="proy-ingreso" inputmode="decimal" placeholder="${moneyStr(data.supuestos.ingreso)}" value="${esc(proySupuestos.ingreso)}" style="width:130px"></label>
        <label>Gasto mensual<br><input type="text" id="proy-gasto" inputmode="decimal" placeholder="${moneyStr(data.supuestos.gasto)}" value="${esc(proySupuestos.gasto)}" style="width:130px"></label>
        <label>Pago extra a deudas<br><input type="text" id="proy-extra" inputmode="decimal" placeholder="0.00" value="${esc(proySupuestos.extra)}" style="width:130px"></label>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Balance acumulado</div><div class="kpi-value ${data.kpis.balanceFinal >= 0 ? 'pos' : 'neg'}">${fmtRD(data.kpis.balanceFinal)}</div></div>
      <div class="kpi"><div class="kpi-label">Ahorro mensual proy.</div><div class="kpi-value">${fmtRD(data.kpis.ahorroMensualProy)}</div></div>
      <div class="kpi"><div class="kpi-label">Deuda proyectada</div><div class="kpi-value">${fmtRD(data.kpis.deudaFinal)}</div></div>
      <div class="kpi"><div class="kpi-label">Escenario</div><div class="kpi-value" style="text-transform:capitalize">${data.kpis.escenario}</div></div>
    </div>

    <div class="split-2">
      <div class="card">
        <h2>Balance acumulado proyectado</h2>
        <div style="display:flex;gap:3px;height:120px;align-items:flex-end">
          ${data.meses.map((m) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
            <div style="width:100%;background:${m.balance >= 0 ? 'var(--green)' : 'var(--red)'};border-radius:2px 2px 0 0;height:${Math.max(2, (Math.abs(m.balance) / maxBal) * 100)}%" title="${monthLabel(m.mesKey)}: ${fmtRD(m.balance)}"></div>
          </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <h2>Deuda total proyectada</h2>
        <div style="display:flex;gap:3px;height:120px;align-items:flex-end">
          ${data.meses.map((m) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
            <div style="width:100%;background:var(--amber);border-radius:2px 2px 0 0;height:${Math.max(2, (m.deuda / maxDeuda) * 100)}%" title="${monthLabel(m.mesKey)}: ${fmtRD(m.deuda)}"></div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="split-2">
      <div class="card">
        <h2>Desglose de deudas</h2>
        ${deudaItems.length === 0 ? '<p class="empty-state">Sin deudas activas</p>' : deudaItems.map((i) => `
          <div class="debt-item">
            <span>${esc(i.label)}</span>
            <span class="right">${fmtRD(i.total)}</span>
            <span class="bar"><i style="width:${Math.max(2, (i.total / maxDeudaItem) * 100)}%;background:var(--accent)"></i></span>
          </div>`).join('')}
      </div>
      <div class="card">
        <h2>Metas alcanzables</h2>
        <div class="muted small" style="margin-bottom:0.5rem">Ahorro total proyectado: <strong style="color:var(--green)">${fmtRD(data.ahorroTotalProy)}</strong></div>
        ${data.metasAlcanzables.length === 0 ? '<p class="empty-state">Sin metas activas</p>' : data.metasAlcanzables.map((m) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid var(--border)">
            <span>${esc(m.nombre)}</span>
            <span style="color:${m.alcanzable ? 'var(--green)' : 'var(--amber)'}">${m.alcanzable ? '✓ Alcanzable' : `${m.pct}% del camino`}</span>
          </div>`).join('')}
      </div>
    </div>
  `;

  body.querySelector('#proy-horizonte').onchange = (e) => { horizonte = Number(e.target.value); renderProyeccion(body, viewEl); };
  body.querySelector('#proy-escenario').onchange = (e) => { escenario = e.target.value; renderProyeccion(body, viewEl); };
  [['#proy-ingreso', 'ingreso'], ['#proy-gasto', 'gasto'], ['#proy-extra', 'extra']].forEach(([sel, key]) => {
    const input = body.querySelector(sel);
    attachMoney(input);
    input.addEventListener('change', () => {
      proySupuestos[key] = input.value;
      renderProyeccion(body, viewEl);
    });
  });
}

// ─── Tab Pagos extra ────────────────────────────────────────────────

async function renderPagosExtra(body, viewEl) {
  const data = await apiGet(`/api/reports/pagos-extra?loanId=${peLoanFilter}`);
  const k = data.kpis;

  body.innerHTML = `
    <div style="margin-bottom:1rem">
      <select id="pe-loan-filter">
        <option value="all">Todos los préstamos</option>
        ${data.loans.map((l) => `<option value="${l.id}" ${String(l.id) === peLoanFilter ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}
      </select>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Total abonado a capital</div><div class="kpi-value pos">${fmtRD(k.totalAbonado)}</div></div>
      <div class="kpi"><div class="kpi-label">Promedio por pago</div><div class="kpi-value">${fmtRD(k.promedioPorPago)}</div></div>
      <div class="kpi"><div class="kpi-label">Penalizaciones pagadas</div><div class="kpi-value ${k.penalizacionesPagadas > 0 ? 'neg' : ''}">${fmtRD(k.penalizacionesPagadas)}</div></div>
      <div class="kpi"><div class="kpi-label">Interés evitado (est.)</div><div class="kpi-value pos">${fmtRD(k.interesEvitadoEst)}</div></div>
    </div>
    ${data.porAnio.length === 0 ? '<p class="empty-state">Sin abonos extraordinarios registrados</p>' : data.porAnio.map((a) => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.4rem;flex-wrap:wrap;gap:0.4rem">
          <h2 style="margin:0">${a.anio}</h2>
          <span class="muted small">${a.pagos.length} pago(s) extraordinario(s) · Abono a capital: ${fmtRD(a.totalAbono)}</span>
        </div>
        <div class="progress" style="margin-bottom:0.75rem"><i style="width:${a.pctVsMax}%"></i></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Préstamo</th><th>Fecha</th><th class="right">Abono</th><th class="right">Penalización</th><th class="right">Total</th></tr></thead>
          <tbody>
            ${a.pagos.map((p) => `<tr>
              <td>${esc(p.loanNombre)}</td>
              <td class="muted">${fmtFechaDDMM(p.fechaSort)}</td>
              <td class="right pos">${fmtRD(p.abono)}</td>
              <td class="right">${p.penalizacion > 0 ? `<span class="badge badge-warn">${fmtRD(p.penalizacion)}</span>` : '—'}</td>
              <td class="right">${fmtRD(p.total)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`).join('')}
  `;
  body.querySelector('#pe-loan-filter').onchange = (e) => { peLoanFilter = e.target.value; renderPagosExtra(body, viewEl); };
}

// ─── Tab Cuotas (condensada — detalle completo vive en Tarjetas) ────

async function renderCuotas(body, viewEl) {
  const installments = await apiGet('/api/installments');
  const activas = installments.filter((i) => !i.terminada);
  const deudaPendiente = round2(installments.reduce((a, i) => a + i.saldoPendiente, 0));
  const cuotaTotalMes = round2(activas.reduce((a, i) => a + i.cuotaMensual, 0));
  const totalFinanciado = round2(installments.reduce((a, i) => a + i.montoOriginal, 0));
  const totalIntereses = round2(installments.reduce((a, i) => a + Math.max(0, (i.cuotaMensual * i.numCuotas) - i.montoOriginal), 0));

  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Deuda pendiente en cuotas</div><div class="kpi-value neg">${fmtRD(deudaPendiente)}</div></div>
      <div class="kpi"><div class="kpi-label">Cuota total este mes</div><div class="kpi-value">${fmtRD(cuotaTotalMes)}</div></div>
      <div class="kpi"><div class="kpi-label">Total financiado</div><div class="kpi-value">${fmtRD(totalFinanciado)}</div></div>
      <div class="kpi"><div class="kpi-label">Total en intereses</div><div class="kpi-value">${fmtRD(totalIntereses)}</div></div>
    </div>
    ${installments.length === 0 ? '<p class="empty-state">Sin compras a cuotas registradas</p>' : `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.4rem">
        <h2 style="margin:0">Compras a cuotas</h2>
        <button class="btn btn-ghost btn-sm" id="rep-ver-cuotas">Ver amortización completa en Tarjetas →</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>Descripción</th><th>Tarjeta</th><th class="right">Cuota</th><th class="right">Saldo</th><th>Progreso</th></tr></thead>
        <tbody>
          ${installments.map((i) => `<tr style="${i.terminada ? 'opacity:.5' : ''}">
            <td>${i.icono}</td>
            <td>${esc(i.descripcion)}</td>
            <td class="muted">${esc(i.cardLabel)}</td>
            <td class="right">${fmtRD(i.cuotaMensual)}</td>
            <td class="right">${fmtRD(i.saldoPendiente)}</td>
            <td style="min-width:140px">
              ${progressBar(i.progresoPct)}
              <span class="small muted">${i.cuotasPagadas}/${i.numCuotas}</span>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`}
  `;
  body.querySelector('#rep-ver-cuotas')?.addEventListener('click', () => navigate('tarjetas'));
}

// ─── Tab Tarjetas (condensada — proyección 12 meses vive en Tarjetas) ─

async function renderTarjetas(body, viewEl) {
  const [cards, tendencia] = await Promise.all([
    apiGet('/api/cards'),
    apiGet(`/api/cards/tendencia?month=${currentMonthKey()}`).catch(() => [])
  ]);
  if (cards.length === 0) { body.innerHTML = '<p class="empty-state">Registra una tarjeta para ver este análisis</p>'; return; }

  const deudaTotal = round2(cards.reduce((a, c) => a + c.deudaTotalRD, 0));
  const limiteTotal = round2(cards.reduce((a, c) => a + c.limitRD, 0));
  const usoGlobal = limiteTotal > 0 ? round2((cards.reduce((a, c) => a + Math.max(0, c.usedRD), 0) / limiteTotal) * 100) : 0;
  const intMesTotal = round2(cards.reduce((a, c) => a + Math.max(0, c.usedRD) * (c.tasaInteres / 100 / 12), 0));
  const pagoMinTotal = round2(cards.reduce((a, c) => a + c.pagoMinimoTotalRD, 0));
  const tendMap = new Map(tendencia.map((t) => [t.key, t]));

  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Deuda total</div><div class="kpi-value neg">${fmtRD(deudaTotal)}</div></div>
      <div class="kpi"><div class="kpi-label">Uso global del crédito</div><div class="kpi-value">${usoGlobal}%${overLimitBadge(usoGlobal)}</div></div>
      <div class="kpi"><div class="kpi-label">Intereses este mes</div><div class="kpi-value">${fmtRD(intMesTotal)}</div></div>
      <div class="kpi"><div class="kpi-label">Pago mínimo total</div><div class="kpi-value">${fmtRD(pagoMinTotal)}</div></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem">
        <h2 style="margin:0">Comparativa por tarjeta</h2>
        <button class="btn btn-ghost btn-sm" id="rep-ver-salud">Ver salud crediticia completa →</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Tarjeta</th><th class="right">Saldo</th><th class="right">Límite</th><th class="right">Uso</th><th class="right">Int. mes</th><th>Estado</th></tr></thead>
        <tbody>
          ${cards.map((c) => {
            const intMes = c.usedRD * (c.tasaInteres / 100 / 12);
            const estado = c.usoPctRD > 100
              ? '<span class="badge badge-danger">⚠ Superado</span>'
              : (c.alertaRD && c.usedRD >= c.alertaRD ? '<span class="badge badge-warn">⚠ Alerta</span>' : '<span class="badge badge-ok">✓ Normal</span>');
            return `<tr>
              <td>${esc(c.label)}</td>
              <td class="right">${fmtRD(c.usedRD)}</td>
              <td class="right">${fmtRD(c.limitRD)}</td>
              <td class="right">${c.usoPctRD}%</td>
              <td class="right">${fmtRD(intMes)}</td>
              <td>${estado}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>Tendencia: mes actual vs anterior</h2>
      ${cards.map((c) => {
        const t = tendMap.get(c.key) || { mesActual: 0, mesAnterior: 0 };
        const max = Math.max(t.mesActual, t.mesAnterior, 1);
        const delta = t.mesAnterior > 0 ? ((t.mesActual - t.mesAnterior) / t.mesAnterior) * 100 : (t.mesActual > 0 ? 100 : 0);
        return `<div style="margin-bottom:0.75rem">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem">
            <span>${esc(c.label)}</span><span class="${delta > 0 ? 'neg' : 'pos'}">${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(0)}%</span>
          </div>
          <div class="progress"><i style="width:${(t.mesActual / max) * 100}%;background:var(--accent)"></i></div>
        </div>`;
      }).join('')}
    </div>
  `;
  body.querySelector('#rep-ver-salud').addEventListener('click', () => navigate('tarjetas'));
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
