import { apiGet, apiPost, apiPut, apiDelete } from '../api.js';
import { esc, toast, confirmDialog, openModal, progressBar } from '../ui.js';
import { fmtRD, fmtFechaDDMM, todayISO, pad2 } from '../format.js';
import { attachMoney, moneyToNum } from '../money.js';

export async function render(el) {
  const loans = await apiGet('/api/loans');
  const activos = loans.filter((l) => !l.saldado && l.activo);
  const totalSaldo = activos.reduce((a, l) => a + l.saldoPendiente, 0);
  const totalCuotas = activos.reduce((a, l) => a + l.cuotaMensual, 0);
  const totalInteresPagado = loans.reduce((a, l) => a + l.interesPagado, 0);

  el.innerHTML = `
    <div class="section-head">
      <h1>Préstamos</h1>
      <button id="add-loan" class="btn btn-primary">＋ Nuevo préstamo</button>
    </div>

    ${loans.length > 0 ? `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Saldo pendiente total</div><div class="kpi-value neg">${fmtRD(totalSaldo)}</div></div>
      <div class="kpi"><div class="kpi-label">Cuotas mensuales</div><div class="kpi-value">${fmtRD(totalCuotas)}</div></div>
      <div class="kpi"><div class="kpi-label">Intereses/cargos pagados</div><div class="kpi-value" style="color:var(--amber)">${fmtRD(totalInteresPagado)}</div><div class="kpi-sub">histórico, todos los préstamos</div></div>
      <div class="kpi"><div class="kpi-label">Activos</div><div class="kpi-value">${activos.length}</div></div>
    </div>` : ''}

    <div class="card">
      ${loans.length === 0 ? '<p class="empty-state">Sin préstamos registrados</p>' : `
      <div class="table-wrap"><table>
        <thead>
          <tr><th>Préstamo</th><th>Banco</th><th class="right">Cuota</th><th class="right">Saldo</th><th>Progreso</th><th>Próx. pago</th><th></th></tr>
        </thead>
        <tbody>
          ${loans.map((l) => `
            <tr>
              <td>${esc(l.nombre)}${l.saldado ? ' <span class="badge badge-ok">saldado</span>' : ''}
                <div class="muted small">${l.tasaAnual}% anual${l.penalidadPct > 0 ? ` · penalidad ${l.penalidadPct}%` : ''}</div></td>
              <td class="muted">${esc(l.banco || '')}</td>
              <td class="right">${fmtRD(l.cuotaMensual)}</td>
              <td class="right ${l.saldado ? 'pos' : 'neg'}">${fmtRD(l.saldoPendiente)}</td>
              <td style="min-width:140px">
                <span class="small muted">${l.progresoPct}% amortizado</span>
                ${progressBar(l.progresoPct)}
              </td>
              <td class="muted">${l.proximaCuotaFecha ? fmtFechaDDMM(l.proximaCuotaFecha) : '—'}</td>
              <td style="white-space:nowrap">
                ${!l.saldado ? `<button class="btn btn-sm btn-success" data-pay="${l.id}">Pagar cuota</button>
                <button class="btn btn-sm" data-extra="${l.id}" title="Abono extra a capital">⚡ Abono</button>` : ''}
                <button class="btn btn-sm" data-detalle="${l.id}" title="Amortización y pagos">📋</button>
                <button class="btn btn-sm btn-ghost" data-del="${l.id}" title="Eliminar">🗑</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>

    ${activos.length >= 2 ? estrategiaCardHTML() : ''}
  `;

  el.querySelector('#add-loan').onclick = () => openLoanForm(el);

  el.querySelectorAll('[data-pay]').forEach((b) => {
    const loan = loans.find((l) => l.id === Number(b.dataset.pay));
    b.onclick = async () => {
      const ok = await confirmDialog(
        `¿Registrar el pago de la cuota de <strong>${esc(loan.nombre)}</strong> por ${fmtRD(loan.cuotaMensual)}?<br>
         <span class="muted small">El interés se calcula sobre el saldo actual; el saldo baja solo por el capital.</span>`,
        { okLabel: 'Pagar cuota' }
      );
      if (!ok) return;
      try {
        const r = await apiPost(`/api/loans/${loan.id}/pay`, { fechaSort: todayISO() });
        toast(`Cuota pagada: interés ${fmtRD(r.pago.interes)} + capital ${fmtRD(r.pago.capital)}`, 'success');
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  el.querySelectorAll('[data-extra]').forEach((b) => {
    const loan = loans.find((l) => l.id === Number(b.dataset.extra));
    b.onclick = () => openExtraModal(el, loan);
  });

  el.querySelectorAll('[data-detalle]').forEach((b) => {
    const loan = loans.find((l) => l.id === Number(b.dataset.detalle));
    b.onclick = () => openDetalleModal(loan);
  });

  el.querySelectorAll('[data-del]').forEach((b) => {
    const loan = loans.find((l) => l.id === Number(b.dataset.del));
    b.onclick = async () => {
      if (!await confirmDialog(`¿Eliminar el préstamo <strong>${esc(loan.nombre)}</strong>?`, { danger: true, okLabel: 'Eliminar' })) return;
      try {
        await apiDelete(`/api/loans/${loan.id}`);
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  if (activos.length >= 2) bindEstrategia(el);
}

// ─── Alta con 3 modos de fecha y simulador previo ───────────

// Deriva fechaInicio según el modo elegido (aritmética por string,
// reutilizando la misma lógica de meses cortos del backend)
function addMonthsISO(iso, n) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = new Date(ny, nm, 0).getDate();
  return `${ny}-${pad2(nm)}-${pad2(Math.min(d, dim))}`;
}

function frenchPaymentLocal(P, tasaAnual, n) {
  const i = tasaAnual / 100 / 12;
  return i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n));
}

function openLoanForm(viewEl) {
  const m = openModal(`
    <h2>Nuevo préstamo</h2>
    <form id="loan-form" class="form-grid">
      <label class="full">Nombre<input type="text" name="nombre" required placeholder="Préstamo vehículo"></label>
      <label>Banco<input type="text" name="banco" placeholder="Popular, BHD…"></label>
      <label>Monto original RD$<input type="text" name="original" inputmode="decimal" required placeholder="0.00"></label>
      <label>Tasa % anual<input type="number" name="tasaAnual" step="0.01" min="0" required></label>
      <label>Plazo (meses)<input type="number" name="plazoMeses" min="1" required></label>
      <label>Día de pago<input type="number" name="diaPago" min="1" max="31" required></label>
      <label>Penalidad prepago %<input type="number" name="penalidadPct" step="0.1" min="0" max="100" value="0"></label>
      <label>Definir fechas por
        <select name="modoFecha">
          <option value="inicio">Fecha de inicio</option>
          <option value="primer_pago">Fecha del primer pago</option>
          <option value="vencimiento">Fecha de vencimiento</option>
        </select>
      </label>
      <label id="fecha-label">Fecha de inicio<input type="date" name="fecha" value="${todayISO()}" required></label>
    </form>
    <div id="loan-preview" class="muted small" style="margin-top:0.75rem">Cuota mensual estimada: —</div>
    <div class="modal-actions">
      <button class="btn" data-act="tabla">📋 Ver tabla completa</button>
      <button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn btn-primary" data-act="save">Crear préstamo</button>
    </div>
  `);

  const form = m.el.querySelector('#loan-form');
  attachMoney(form.original);

  const FECHA_LABELS = {
    inicio: 'Fecha de inicio',
    primer_pago: 'Fecha del primer pago',
    vencimiento: 'Fecha de vencimiento (última cuota)'
  };
  form.modoFecha.addEventListener('change', () => {
    m.el.querySelector('#fecha-label').firstChild.textContent = FECHA_LABELS[form.modoFecha.value];
    preview();
  });

  // fechaInicio derivada según el modo:
  // primer pago = inicio + 1 mes → inicio = fecha - 1 mes
  // vencimiento = inicio + plazo meses → inicio = fecha - plazo meses
  function derivarInicio() {
    const fecha = form.fecha.value;
    const plazo = Number(form.plazoMeses.value);
    if (!fecha) return null;
    if (form.modoFecha.value === 'primer_pago') return addMonthsISO(fecha, -1);
    if (form.modoFecha.value === 'vencimiento') return plazo > 0 ? addMonthsISO(fecha, -plazo) : null;
    return fecha;
  }

  function preview() {
    const P = moneyToNum(form.original);
    const t = Number(form.tasaAnual.value);
    const n = Number(form.plazoMeses.value);
    const out = m.el.querySelector('#loan-preview');
    if (P > 0 && n > 0 && t >= 0) {
      const cuota = frenchPaymentLocal(P, t, n);
      const total = cuota * n;
      const inicio = derivarInicio();
      out.innerHTML = `Cuota mensual: <strong>${fmtRD(cuota)}</strong> · Total a pagar: ${fmtRD(total)} ·
        Intereses totales: ${fmtRD(total - P)}${inicio ? ` · Inicio: ${esc(inicio)}` : ''}`;
    } else {
      out.textContent = 'Cuota mensual estimada: —';
    }
  }
  form.addEventListener('input', preview);

  // Simulador: tabla de amortización completa ANTES de crear
  m.el.querySelector('[data-act="tabla"]').onclick = () => {
    const P = moneyToNum(form.original);
    const t = Number(form.tasaAnual.value);
    const n = Number(form.plazoMeses.value);
    if (!(P > 0 && n > 0 && t >= 0)) return toast('Completa monto, tasa y plazo primero', 'error');
    const cuota = frenchPaymentLocal(P, t, n);
    let saldo = P;
    const rows = [];
    for (let k = 1; k <= n; k++) {
      const interes = saldo * (t / 100 / 12);
      let capital = Math.min(cuota - interes, saldo);
      // la última cuota absorbe el residuo de redondeo (igual que el backend)
      if (saldo - capital <= 1) capital = saldo;
      saldo = Math.max(0, saldo - capital);
      rows.push({ k, interes, capital, saldo });
      if (saldo <= 0) break;
    }
    const mt = openModal(`
      <h2>Simulación — tabla de amortización</h2>
      <p class="muted small">${fmtRD(P)} al ${t}% anual en ${n} cuotas de ${fmtRD(cuota)} (nada se guarda todavía)</p>
      <div class="table-wrap" style="max-height:380px;overflow-y:auto"><table>
        <thead><tr><th>#</th><th class="right">Cuota</th><th class="right">Interés</th><th class="right">Capital</th><th class="right">Saldo</th></tr></thead>
        <tbody>${rows.map((r2) => `<tr><td>${r2.k}</td><td class="right">${fmtRD(r2.interes + r2.capital)}</td><td class="right">${fmtRD(r2.interes)}</td><td class="right">${fmtRD(r2.capital)}</td><td class="right">${fmtRD(r2.saldo)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="modal-actions"><button class="btn" data-act="close">Cerrar</button></div>
    `);
    mt.el.style.maxWidth = '680px'; // tabla de 5 columnas de montos
    mt.el.querySelector('[data-act="close"]').onclick = mt.close;
  };

  m.el.querySelector('[data-act="cancel"]').onclick = m.close;
  m.el.querySelector('[data-act="save"]').onclick = async () => {
    const fechaInicio = derivarInicio();
    if (!fechaInicio) return toast('Completa la fecha y el plazo', 'error');
    try {
      const loan = await apiPost('/api/loans', {
        nombre: form.nombre.value.trim(),
        banco: form.banco.value.trim() || undefined,
        original: moneyToNum(form.original),
        tasaAnual: Number(form.tasaAnual.value),
        plazoMeses: Number(form.plazoMeses.value),
        diaPago: Number(form.diaPago.value),
        penalidadPct: Number(form.penalidadPct.value || 0),
        fechaInicio
      });
      m.close();
      toast(`Préstamo creado — cuota ${fmtRD(loan.cuotaMensual)}`, 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ─── Detalle: pagos reales + proyección de cuotas restantes ─

async function openDetalleModal(loan) {
  const [pagosData, scheduleData] = await Promise.all([
    apiGet(`/api/loans/${loan.id}/pagos`),
    loan.saldado ? Promise.resolve({ schedule: [], interesRestante: 0 }) : apiGet(`/api/loans/${loan.id}/schedule`)
  ]);

  const m = openModal(`
    <h2>${esc(loan.nombre)}</h2>
    <p class="muted small">${fmtRD(loan.original)} al ${loan.tasaAnual}% · saldo ${fmtRD(loan.saldoPendiente)} ·
      intereses/cargos pagados: <strong>${fmtRD(loan.interesPagado)}</strong>
      ${!loan.saldado ? ` · interés restante proyectado: ${fmtRD(scheduleData.interesRestante)}` : ''}</p>

    <h3>Pagos realizados (${pagosData.pagos.length})</h3>
    ${pagosData.pagos.length === 0 ? '<p class="empty-state">Sin pagos todavía</p>' : `
    <div class="table-wrap" style="max-height:200px;overflow-y:auto"><table>
      <tbody>${pagosData.pagos.map((p) => `
        <tr>
          <td class="muted">${fmtFechaDDMM(p.fechaSort)}</td>
          <td>${esc(p.nombre)}${p.esAbonoExtra ? ' <span class="badge badge-ok">extra</span>' : ''}</td>
          <td class="right">${fmtRD(p.monto)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`}

    ${!loan.saldado ? `
    <h3 style="margin-top:1rem">Cuotas restantes (proyección: ${scheduleData.schedule.length})</h3>
    <div class="table-wrap" style="max-height:260px;overflow-y:auto"><table>
      <thead><tr><th>#</th><th>Fecha</th><th class="right">Cuota</th><th class="right">Interés</th><th class="right">Capital</th><th class="right">Saldo</th></tr></thead>
      <tbody>${scheduleData.schedule.map((s) => `
        <tr>
          <td>${s.n}</td>
          <td>${fmtFechaDDMM(s.fecha)}</td>
          <td class="right">${fmtRD(s.cuota)}</td>
          <td class="right">${fmtRD(s.interes)}</td>
          <td class="right">${fmtRD(s.capital)}</td>
          <td class="right">${fmtRD(s.saldo)}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : ''}

    <div class="modal-actions"><button class="btn" data-act="close">Cerrar</button></div>
  `);
  m.el.style.maxWidth = '680px'; // proyección de 6 columnas de montos
  m.el.querySelector('[data-act="close"]').onclick = m.close;
}

// ─── Abono extra con simulación en vivo de ambos modos ──────

function openExtraModal(viewEl, loan) {
  const m = openModal(`
    <h2>⚡ Abono extra — ${esc(loan.nombre)}</h2>
    <p class="muted small">Saldo actual: ${fmtRD(loan.saldoPendiente)} · cuota: ${fmtRD(loan.cuotaMensual)}
      ${loan.penalidadPct > 0 ? ` · penalidad por prepago: ${loan.penalidadPct}%` : ''}</p>
    <form id="extra-form" class="form-grid">
      <label>Monto del abono RD$<input type="text" name="monto" inputmode="decimal" required placeholder="0.00"></label>
      <label>Modo
        <select name="modo">
          <option value="reducir_plazo">Reducir plazo (misma cuota, termina antes)</option>
          <option value="reducir_cuota">Reducir cuota (mismo plazo, cuota menor)</option>
        </select>
      </label>
    </form>
    <div id="extra-sim" class="small" style="margin-top:0.75rem"><span class="muted">Escribe un monto para ver la simulación.</span></div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn btn-primary" data-act="apply" disabled>Aplicar abono</button>
    </div>
  `);

  m.el.style.maxWidth = '640px'; // la tabla comparativa de 4 columnas necesita más ancho
  const form = m.el.querySelector('#extra-form');
  const simEl = m.el.querySelector('#extra-sim');
  const applyBtn = m.el.querySelector('[data-act="apply"]');
  attachMoney(form.monto);

  let simTimer = null;
  async function runSim() {
    const monto = moneyToNum(form.monto);
    if (monto <= 0) {
      simEl.innerHTML = '<span class="muted">Escribe un monto para ver la simulación.</span>';
      applyBtn.disabled = true;
      return;
    }
    try {
      const s = await apiPost(`/api/loans/${loan.id}/simular-extra`, { monto });
      const fm = (mn) => (Number.isFinite(mn) ? `${mn} meses` : '∞');
      simEl.innerHTML = `
        <div style="border:1px solid var(--border);border-radius:8px;padding:0.7rem 0.9rem">
          Capital aplicado: <strong>${fmtRD(s.capitalAplicado)}</strong>
          ${s.penalidad > 0 ? ` · Penalidad: <strong style="color:var(--amber)">${fmtRD(s.penalidad)}</strong>` : ''}
          · Desembolso total: <strong>${fmtRD(s.totalDesembolso)}</strong>
          ${s.liquidaPrestamo ? '<div class="pos" style="margin-top:0.3rem">✓ Este abono liquida el préstamo por completo</div>' : `
          <div style="overflow-x:auto"><table style="margin-top:0.5rem;width:100%">
            <thead><tr><th></th><th>Sin abono</th><th>Reducir plazo</th><th>Reducir cuota</th></tr></thead>
            <tbody>
              <tr><td class="muted">Meses restantes</td><td>${fm(s.sinAbono.meses)}</td><td>${fm(s.reducirPlazo.meses)}</td><td>${fm(s.reducirCuota.meses)}</td></tr>
              <tr><td class="muted">Cuota mensual</td><td>${fmtRD(loan.cuotaMensual)}</td><td>${fmtRD(s.reducirPlazo.cuota)}</td><td>${fmtRD(s.reducirCuota.cuota)}</td></tr>
              <tr><td class="muted">Interés restante</td><td>${fmtRD(s.sinAbono.interes)}</td><td>${fmtRD(s.reducirPlazo.interes)}</td><td>${fmtRD(s.reducirCuota.interes)}</td></tr>
              <tr><td class="muted">Ahorro neto*</td><td>—</td>
                <td class="pos">${s.reducirPlazo.ahorroInteres !== null ? fmtRD(s.reducirPlazo.ahorroInteres) : '—'}</td>
                <td class="pos">${s.reducirCuota.ahorroInteres !== null ? fmtRD(s.reducirCuota.ahorroInteres) : '—'}</td></tr>
            </tbody>
          </table></div>
          <div class="muted" style="margin-top:0.3rem">* Ahorro de intereses menos la penalidad.</div>`}
        </div>`;
      applyBtn.disabled = false;
    } catch (err) {
      simEl.innerHTML = `<span class="neg">${esc(err.message)}</span>`;
      applyBtn.disabled = true;
    }
  }
  form.monto.addEventListener('input', () => {
    clearTimeout(simTimer);
    simTimer = setTimeout(runSim, 350);
  });

  m.el.querySelector('[data-act="cancel"]').onclick = m.close;
  applyBtn.onclick = async () => {
    const monto = moneyToNum(form.monto);
    const modo = form.modo.value;
    const ok = await confirmDialog(
      `¿Aplicar abono extra de <strong>${fmtRD(monto)}</strong> a ${esc(loan.nombre)} en modo
       <strong>${modo === 'reducir_plazo' ? 'reducir plazo' : 'reducir cuota'}</strong>?`,
      { okLabel: 'Aplicar abono' }
    );
    if (!ok) return;
    try {
      const r = await apiPost(`/api/loans/${loan.id}/pay-extra`, { monto, modo, fechaSort: todayISO() });
      m.close();
      toast(`Abono aplicado: capital ${fmtRD(r.aplicado.capital)}${r.aplicado.penalidad > 0 ? ` + penalidad ${fmtRD(r.aplicado.penalidad)}` : ''}`, 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ─── Estrategia de deudas (≥2 préstamos activos) ────────────

function estrategiaCardHTML() {
  return `
    <div class="card" id="estrategia-card">
      <h2>🏔️ Estrategia de pago de deudas</h2>
      <p class="muted small">Compara cuánto ahorras destinando un monto extra mensual a tus préstamos.
        <strong>Bola de nieve</strong>: ataca el menor saldo primero (victorias rápidas, motivacional).
        <strong>Avalancha</strong>: ataca la mayor tasa primero (matemáticamente óptima).</p>
      <div class="form-grid">
        <label>Extra mensual disponible RD$
          <input type="text" id="est-extra" inputmode="decimal" placeholder="5,000.00">
        </label>
        <button class="btn btn-primary" id="est-calcular">Calcular</button>
      </div>
      <div id="est-result" style="margin-top:0.75rem"></div>
    </div>`;
}

function bindEstrategia(el) {
  const input = el.querySelector('#est-extra');
  attachMoney(input);
  el.querySelector('#est-calcular').onclick = async () => {
    const extra = moneyToNum(input);
    if (extra <= 0) return toast('Ingresa el monto extra mensual', 'error');
    const out = el.querySelector('#est-result');
    out.innerHTML = '<span class="muted small">Calculando…</span>';
    try {
      const r = await apiGet(`/api/loans/estrategia?extra=${extra}`);
      const fm = (mn) => (Number.isFinite(mn) ? `${mn} meses (${(mn / 12).toFixed(1)} años)` : '∞');
      const fi = (v) => (Number.isFinite(v) ? fmtRD(v) : '∞');
      const ahorroNieve = Number.isFinite(r.baseline.interesTotal) && Number.isFinite(r.nieve.interesTotal)
        ? r.baseline.interesTotal - r.nieve.interesTotal : null;
      const ahorroAva = Number.isFinite(r.baseline.interesTotal) && Number.isFinite(r.avalancha.interesTotal)
        ? r.baseline.interesTotal - r.avalancha.interesTotal : null;
      out.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>Sin extra</th><th>❄️ Bola de nieve</th><th>⛰️ Avalancha</th></tr></thead>
          <tbody>
            <tr><td class="muted">Libre de deudas en</td><td>${fm(r.baseline.meses)}</td><td>${fm(r.nieve.meses)}</td><td>${fm(r.avalancha.meses)}</td></tr>
            <tr><td class="muted">Interés total</td><td>${fi(r.baseline.interesTotal)}</td><td>${fi(r.nieve.interesTotal)}</td><td>${fi(r.avalancha.interesTotal)}</td></tr>
            <tr><td class="muted">Ahorro vs sin extra</td><td>—</td>
              <td class="pos">${ahorroNieve !== null ? fmtRD(ahorroNieve) : '—'}</td>
              <td class="pos">${ahorroAva !== null ? fmtRD(ahorroAva) : '—'}</td></tr>
            <tr><td class="muted">Orden de ataque</td><td>—</td>
              <td class="small">${r.nieve.orden.map(esc).join(' → ')}</td>
              <td class="small">${r.avalancha.orden.map(esc).join(' → ')}</td></tr>
          </tbody>
        </table></div>
        <p class="muted small" style="margin-top:0.4rem">${esc(r.nota)} Cuando un préstamo se liquida, su cuota se suma al extra del siguiente (efecto bola de nieve).</p>`;
    } catch (err) {
      out.innerHTML = `<span class="neg small">${esc(err.message)}</span>`;
    }
  };
}
