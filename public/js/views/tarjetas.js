import { apiGet, apiPost, apiPut, apiDelete } from '../api.js';
import { esc, toast, confirmDialog, openModal, progressBar, overLimitBadge } from '../ui.js';
import { fmtRD, fmtUSD, fmtFechaDDMM, todayISO, currentMonthKey } from '../format.js';
import { attachMoney, moneyToNum } from '../money.js';
import { state } from '../state.js';

const CARD_ACCENTS = ['#7c6fef', '#199e70', '#3987e5', '#c98500', '#e66767'];

let tab = 'consumos';
let consolidadoSel = null; // Map<key, bool> — null = aún no inicializado

export async function render(el) {
  const cards = await apiGet('/api/cards');

  if (!consolidadoSel) consolidadoSel = new Map(cards.map((c) => [c.key, true]));
  else for (const c of cards) if (!consolidadoSel.has(c.key)) consolidadoSel.set(c.key, true);

  el.innerHTML = `
    <div class="section-head">
      <h1>Tarjetas de crédito</h1>
      ${tab === 'consumos' ? '<button id="add-card" class="btn btn-primary">＋ Nueva tarjeta</button>' : ''}
    </div>

    <div class="tabs">
      <button data-tab="consumos" class="${tab === 'consumos' ? 'active' : ''}">Consumos</button>
      <button data-tab="cuotas" class="${tab === 'cuotas' ? 'active' : ''}">💳 Cuotas</button>
      <button data-tab="salud" class="${tab === 'salud' ? 'active' : ''}">🩺 Salud crediticia</button>
    </div>

    <div id="tc-body"></div>
  `;

  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { tab = b.dataset.tab; render(el); };
  });

  const body = el.querySelector('#tc-body');
  if (tab === 'consumos') await renderConsumos(body, el, cards);
  else if (tab === 'cuotas') await renderCuotas(body, el, cards);
  else await renderSalud(body, el, cards);
}

// ─── Tab Consumos ────────────────────────────────────────────

async function renderConsumos(body, viewEl, cards) {
  body.innerHTML = `
    ${cards.length === 0 ? '<div class="card"><p class="empty-state">Registra tu primera tarjeta para empezar a controlarla</p></div>' : `
    <div class="cc-grid">
      ${cards.map((c, i) => `
        <div class="cc-card" style="border-left:3px solid ${CARD_ACCENTS[i % CARD_ACCENTS.length]}">
          <div class="cc-head">
            <strong>${esc(c.label)}</strong>
            <span class="cc-meta">${esc(c.bank || '')} ${esc(c.red || '')}</span>
          </div>
          <div class="cc-meta">${esc(c.producto || '')}</div>

          <div style="margin-top:0.6rem">
            <div class="small">RD$ · ${fmtRD(c.usedRD)} / ${fmtRD(c.limitRD)} <span class="muted">(${c.usoPctRD}%)</span> ${overLimitBadge(c.usoPctRD)}${c.usedRD < 0 ? ` <span class="badge badge-ok">saldo a favor ${fmtRD(-c.usedRD)}</span>` : ''}</div>
            ${progressBar(c.usoPctRD)}
          </div>

          ${c.limitUSD > 0 || c.usedUSD !== 0 ? `
          <div>
            <div class="small">USD$ · ${fmtUSD(c.usedUSD)} / ${fmtUSD(c.limitUSD)} <span class="muted">(${c.usoPctUSD}%)</span> ${overLimitBadge(c.usoPctUSD)}</div>
            ${progressBar(c.usoPctUSD)}
          </div>` : ''}

          <div class="cc-meta" style="margin-top:0.5rem">
            Corte: día ${c.diaCorte} (${fmtFechaDDMM(c.proximoCorte)}) ·
            Pago: día ${c.diaPago} (${fmtFechaDDMM(c.proximoPago)})<br>
            Pago mínimo: <strong>${fmtRD(c.pagoMinimoTotalRD)}</strong> (${c.pagoMinimoPct}%) ·
            Tasa: ${c.tasaInteres}% anual
          </div>

          <div class="cc-actions">
            <button class="btn btn-sm btn-success" data-pay="${c.id}">💵 Pagar</button>
            <button class="btn btn-sm" data-edit="${c.id}">✏️ Editar</button>
            <button class="btn btn-sm btn-danger" data-del="${c.id}">🗑 Eliminar</button>
          </div>
        </div>`).join('')}
    </div>`}

    ${cards.length > 1 ? consolidadoHTML(cards) : ''}
  `;

  viewEl.querySelector('#add-card').onclick = () => openCardForm(viewEl, null);

  body.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => openCardForm(viewEl, cards.find((c) => c.id === Number(b.dataset.edit)));
  });

  body.querySelectorAll('[data-del]').forEach((b) => {
    const card = cards.find((c) => c.id === Number(b.dataset.del));
    b.onclick = async () => {
      const ok = await confirmDialog(
        `¿Eliminar la tarjeta <strong>${esc(card.label)}</strong>? Sus transacciones históricas se conservan.`,
        { danger: true, okLabel: 'Eliminar tarjeta' }
      );
      if (!ok) return;
      try {
        await apiDelete(`/api/cards/${card.id}`);
        toast('Tarjeta eliminada', 'success');
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  body.querySelectorAll('[data-pay]').forEach((b) => {
    const card = cards.find((c) => c.id === Number(b.dataset.pay));
    b.onclick = () => openPayForm(viewEl, card);
  });

  if (cards.length > 1) bindConsolidado(body, viewEl, cards);
}

function consolidadoHTML(cards) {
  // state.exchangeRate siempre existe (default del cliente en state.js,
  // reemplazado por el valor del servidor al entrar a la app)
  const rate = state.exchangeRate.rate;
  const selKeys = cards.filter((c) => consolidadoSel.get(c.key) !== false);
  const totalRD = selKeys.reduce((a, c) => a + c.usedRD, 0);
  const totalUSD = selKeys.reduce((a, c) => a + c.usedUSD, 0);
  const usdEnRD = totalUSD * rate;
  const equiv = totalRD + usdEnRD;

  return `
    <div class="card">
      <h2>Consolidado</h2>
      <div class="cc-pills">
        ${cards.map((c) => {
          const sel = consolidadoSel.get(c.key) !== false;
          return `<button type="button" class="cc-pill ${sel ? 'selected' : ''}" data-pill="${esc(c.key)}">
            ${sel ? '✓' : '○'} ${esc(c.bank || c.label)} ···${esc((c.label.match(/\d{3,}$/) || [''])[0])}
          </button>`;
        }).join('')}
      </div>
      <div class="kpis" style="margin-top:0.75rem;margin-bottom:0">
        <div class="kpi"><div class="kpi-label">Total RD$</div><div class="kpi-value">${fmtRD(totalRD)}</div></div>
        <div class="kpi"><div class="kpi-label">Total USD$</div><div class="kpi-value">${fmtUSD(totalUSD)}</div></div>
        <div class="kpi"><div class="kpi-label">USD → RD$ equiv.</div><div class="kpi-value">${fmtRD(usdEnRD)}</div></div>
        <div class="kpi"><div class="kpi-label">Total equivalente</div><div class="kpi-value neg">${fmtRD(equiv)}</div></div>
      </div>
    </div>`;
}

function bindConsolidado(body, viewEl, cards) {
  body.querySelectorAll('[data-pill]').forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.pill;
      consolidadoSel.set(key, !(consolidadoSel.get(key) !== false));
      renderConsumos(body, viewEl, cards);
    };
  });
}

// Formulario de alta/edición: pre-pobla todos los campos al editar
function openCardForm(viewEl, card) {
  const v = (k, def = '') => (card ? card[k] : def);
  const m = openModal(`
    <h2>${card ? `Editar ${esc(card.label)}` : 'Nueva tarjeta'}</h2>
    <form id="card-form" class="form-grid">
      <label class="full">Nombre / label
        <input type="text" name="label" required value="${esc(v('label'))}" placeholder="BHD Premia">
      </label>
      <label>Banco<input type="text" name="bank" value="${esc(v('bank'))}" placeholder="BHD, Popular…"></label>
      <label>Red
        <select name="red">
          ${['', 'Visa', 'Mastercard', 'Amex', 'Discover'].map((r) =>
            `<option value="${r}" ${v('red') === r ? 'selected' : ''}>${r || '—'}</option>`).join('')}
        </select>
      </label>
      <label>Producto<input type="text" name="producto" value="${esc(v('producto'))}" placeholder="Gold, Platinum…"></label>
      <label>Límite RD$<input type="number" name="limitRD" step="0.01" min="0" value="${v('limitRD', 0)}"></label>
      <label>Usado RD$<input type="number" name="usedRD" step="0.01" value="${v('usedRD', 0)}"></label>
      <label>Límite USD$<input type="number" name="limitUSD" step="0.01" min="0" value="${v('limitUSD', 0)}"></label>
      <label>Usado USD$<input type="number" name="usedUSD" step="0.01" value="${v('usedUSD', 0)}"></label>
      <label>Día de corte<input type="number" name="diaCorte" min="1" max="31" required value="${v('diaCorte')}"></label>
      <label>Día de pago<input type="number" name="diaPago" min="1" max="31" required value="${v('diaPago')}"></label>
      <label>% pago mínimo<input type="number" name="pagoMinimoPct" step="0.1" min="0" value="${v('pagoMinimoPct', 5)}"></label>
      <label>Tasa interés % anual<input type="number" name="tasaInteres" step="0.1" min="0" value="${v('tasaInteres', 60)}"></label>
      <label>Alerta al llegar a RD$<input type="number" name="alertaRD" step="0.01" min="0" value="${v('alertaRD') ?? ''}"></label>
      <label style="display:flex;align-items:center;gap:0.4rem;margin-top:1.2rem">
        <input type="checkbox" name="dobleSaldo" style="width:auto" ${v('dobleSaldo') ? 'checked' : ''}> Doble saldo (RD$ y USD$)
      </label>
    </form>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn btn-primary" data-act="save">${card ? 'Guardar cambios' : 'Crear tarjeta'}</button>
    </div>
  `);

  m.el.querySelector('[data-act="cancel"]').onclick = m.close;
  m.el.querySelector('[data-act="save"]').onclick = async () => {
    const f = new FormData(m.el.querySelector('#card-form'));
    const payload = {
      label: f.get('label'),
      bank: f.get('bank') || undefined,
      red: f.get('red') || undefined,
      producto: f.get('producto') || undefined,
      limitRD: Number(f.get('limitRD') || 0),
      usedRD: Number(f.get('usedRD') || 0),
      limitUSD: Number(f.get('limitUSD') || 0),
      usedUSD: Number(f.get('usedUSD') || 0),
      diaCorte: Number(f.get('diaCorte')),
      diaPago: Number(f.get('diaPago')),
      pagoMinimoPct: Number(f.get('pagoMinimoPct') || 5),
      tasaInteres: Number(f.get('tasaInteres') || 60),
      alertaRD: f.get('alertaRD') ? Number(f.get('alertaRD')) : undefined,
      dobleSaldo: f.get('dobleSaldo') === 'on'
    };
    try {
      if (card) await apiPut(`/api/cards/${card.id}`, payload);
      else await apiPost('/api/cards', payload);
      m.close();
      toast(card ? 'Tarjeta actualizada' : 'Tarjeta creada', 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// Pago de tarjeta: transferencia que baja el saldo usado, nunca es gasto
function openPayForm(viewEl, card) {
  const m = openModal(`
    <h2>Pagar ${esc(card.label)}</h2>
    <p class="muted small">Saldo usado: ${fmtRD(card.usedRD)}${card.usedUSD ? ` + ${fmtUSD(card.usedUSD)}` : ''} ·
      Pago mínimo: ${fmtRD(card.pagoMinimoTotalRD)}</p>
    <form id="pay-form" class="form-grid">
      <label>Monto<input type="number" name="monto" step="0.01" min="0.01" required value="${card.usedRD > 0 ? card.usedRD : ''}"></label>
      <label>Moneda
        <select name="moneda"><option>RD$</option><option>USD$</option></select>
      </label>
      <label>Fecha<input type="date" name="fechaSort" value="${todayISO()}" required></label>
      <label>Desde la cuenta<input type="text" name="cuenta" placeholder="BHD Ahorros…"></label>
    </form>
    <p class="muted small">El pago se registra como <strong>transferencia</strong>: no cuenta como gasto del mes.</p>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn btn-success" data-act="pay">Registrar pago</button>
    </div>
  `);

  m.el.querySelector('[data-act="cancel"]').onclick = m.close;
  m.el.querySelector('[data-act="pay"]').onclick = async () => {
    const f = new FormData(m.el.querySelector('#pay-form'));
    try {
      await apiPost(`/api/cards/${card.id}/pay`, {
        monto: Number(f.get('monto')),
        moneda: f.get('moneda'),
        fechaSort: f.get('fechaSort'),
        cuenta: f.get('cuenta') || undefined
      });
      m.close();
      toast('Pago registrado — saldo actualizado', 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ─── Tab Cuotas ──────────────────────────────────────────────

async function renderCuotas(body, viewEl, cards) {
  const installments = await apiGet('/api/installments');

  const activas = installments.filter((c) => !c.terminada);
  const deudaRestante = activas.reduce((a, c) => a + c.saldoPendiente, 0);
  const cuotaEsteMes = activas.reduce((a, c) => a + c.cuotaMensual, 0);
  const totalOriginal = installments.reduce((a, c) => a + c.montoOriginal, 0);

  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Deuda restante</div><div class="kpi-value neg">${fmtRD(deudaRestante)}</div></div>
      <div class="kpi"><div class="kpi-label">Cuota este mes</div><div class="kpi-value">${fmtRD(cuotaEsteMes)}</div></div>
      <div class="kpi"><div class="kpi-label">Total original</div><div class="kpi-value">${fmtRD(totalOriginal)}</div></div>
      <div class="kpi"><div class="kpi-label">Activas</div><div class="kpi-value">${activas.length}</div></div>
    </div>

    <div class="card">
      <h2>Agregar compra a cuotas</h2>
      ${cards.length === 0 ? '<p class="empty-state">Registra una tarjeta primero</p>' : `
      <form id="cuota-form" class="form-grid">
        <label class="full">Tarjeta
          <select name="cardId" required>${cards.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select>
        </label>
        <label>Descripción<input type="text" name="descripcion" required placeholder="MacBook Pro"></label>
        <label>Ícono <input type="text" name="icono" placeholder="💻" maxlength="4"></label>
        <label>Monto original<input type="text" name="montoOriginal" inputmode="decimal" required placeholder="0.00"></label>
        <label># de cuotas<input type="number" name="numCuotas" min="1" required placeholder="12"></label>
        <label>Tasa anual % <span class="muted small">(0 = sin interés)</span><input type="number" name="tasaAnual" step="0.1" min="0" value="0"></label>
        <label>Fecha de la compra<input type="date" name="fechaInicio" value="${todayISO()}" required></label>
        <button type="submit" class="btn btn-primary">＋ Agregar</button>
      </form>`}
    </div>

    <div class="card">
      <h2>Compras a cuotas</h2>
      ${installments.length === 0 ? '<p class="empty-state">Sin compras a cuotas registradas</p>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Compra</th><th>Tarjeta</th><th class="right">Cuota</th><th class="right">Saldo</th><th>Progreso</th><th>Próx. pago</th><th></th></tr></thead>
        <tbody>
          ${installments.map((c) => `
            <tr>
              <td>${esc(c.icono)} ${esc(c.descripcion)}${c.terminada ? ' <span class="badge badge-ok">saldada</span>' : ''}</td>
              <td class="muted">${esc(c.cardLabel)}</td>
              <td class="right">${fmtRD(c.cuotaMensual)}</td>
              <td class="right ${c.terminada ? 'pos' : 'neg'}">${fmtRD(c.saldoPendiente)}</td>
              <td style="min-width:140px">
                <span class="small muted">${c.cuotasPagadas}/${c.numCuotas} cuotas</span>
                ${progressBar(c.progresoPct)}
              </td>
              <td class="muted">${c.proximaCuotaFecha ? fmtFechaDDMM(c.proximaCuotaFecha) : '—'}</td>
              <td style="white-space:nowrap">
                ${!c.terminada ? `<button class="btn btn-sm btn-success" data-pay-cuota="${c.id}">Pagar</button>` : ''}
                <button class="btn btn-sm" data-schedule="${c.id}" title="Ver amortización">📋</button>
                <button class="btn btn-sm btn-ghost" data-del-cuota="${c.id}" title="Eliminar">🗑</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>
  `;

  const form = body.querySelector('#cuota-form');
  if (form) {
    attachMoney(form.montoOriginal);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const monto = moneyToNum(form.montoOriginal);
      if (monto <= 0) return toast('Monto inválido', 'error');
      try {
        await apiPost('/api/installments', {
          cardId: Number(form.cardId.value),
          descripcion: form.descripcion.value.trim(),
          icono: form.icono.value.trim() || undefined,
          montoOriginal: monto,
          numCuotas: Number(form.numCuotas.value),
          tasaAnual: Number(form.tasaAnual.value || 0),
          fechaInicio: form.fechaInicio.value
        });
        toast('Compra a cuotas agregada', 'success');
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  body.querySelectorAll('[data-pay-cuota]').forEach((b) => {
    const ct = installments.find((c) => c.id === Number(b.dataset.payCuota));
    b.onclick = async () => {
      const ok = await confirmDialog(
        `¿Registrar el pago de la cuota de <strong>${esc(ct.descripcion)}</strong> por ${fmtRD(ct.cuotaMensual)}?`,
        { okLabel: 'Pagar cuota' }
      );
      if (!ok) return;
      try {
        const r = await apiPost(`/api/installments/${ct.id}/pay`, { fechaSort: todayISO() });
        toast(`Cuota pagada: interés ${fmtRD(r.pago.interes)} + capital ${fmtRD(r.pago.capital)}`, 'success');
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  body.querySelectorAll('[data-del-cuota]').forEach((b) => {
    const ct = installments.find((c) => c.id === Number(b.dataset.delCuota));
    b.onclick = async () => {
      if (!await confirmDialog(`¿Eliminar la compra a cuotas <strong>${esc(ct.descripcion)}</strong>?`, { danger: true, okLabel: 'Eliminar' })) return;
      try {
        await apiDelete(`/api/installments/${ct.id}`);
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  body.querySelectorAll('[data-schedule]').forEach((b) => {
    const ct = installments.find((c) => c.id === Number(b.dataset.schedule));
    b.onclick = () => openScheduleModal(ct);
  });
}

async function openScheduleModal(ct) {
  const { schedule } = await apiGet(`/api/installments/${ct.id}/schedule`);
  const m = openModal(`
    <h2>Amortización — ${esc(ct.descripcion)}</h2>
    <p class="muted small">${esc(ct.cardLabel)} · ${fmtRD(ct.montoOriginal)} en ${ct.numCuotas} cuotas</p>
    <div class="table-wrap" style="max-height:400px;overflow-y:auto">
      <table>
        <thead><tr><th>#</th><th>Fecha</th><th class="right">Cuota</th><th class="right">Interés</th><th class="right">Capital</th><th class="right">Saldo</th></tr></thead>
        <tbody>
          ${schedule.map((s) => `
            <tr class="${s.pagada ? 'muted' : ''}">
              <td>${s.n}${s.pagada ? ' ✓' : ''}</td>
              <td>${fmtFechaDDMM(s.fecha)}</td>
              <td class="right">${fmtRD(s.cuota)}</td>
              <td class="right">${fmtRD(s.interes)}</td>
              <td class="right">${fmtRD(s.capital)}</td>
              <td class="right">${fmtRD(s.saldo)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions"><button class="btn" data-act="close">Cerrar</button></div>
  `);
  m.el.querySelector('[data-act="close"]').onclick = m.close;
}

// ─── Tab Salud crediticia ────────────────────────────────────

// Tolerancia de 1 centavo: cuando el pago mínimo es (en la práctica) igual
// al interés del período, el redondeo de punto flotante puede dejarlo
// unos centésimos por debajo sin que la deuda realmente amortice — sin
// esta tolerancia el caso límite se detecta como "360 meses" en vez de
// "nunca se liquida", justo el escenario que es crítico avisar al usuario.
const EPSILON_NO_AMORTIZA = 0.01;

// Piso del pago mínimo mensual que aplican los bancos en RD aunque el
// porcentaje dé menos (valor típico de mercado; el % real es configurable
// por tarjeta, este piso solo evita proyecciones irreales con saldos chicos)
const PAGO_MINIMO_PISO_RD = 500;

function proyeccion12m(cc) {
  // ?? y no ||: una tarjeta con 0% de interés es válida (promo) y no debe
  // proyectarse con la tasa por defecto
  const tasaMens = (cc.tasaInteres ?? 60) / 100 / 12;
  const pagoMinPct = (cc.pagoMinimoPct ?? 5) / 100;

  let saldo = cc.usedRD;
  let intAnual = 0;
  for (let m = 0; m < 12 && saldo > 0; m++) {
    const intM = saldo * tasaMens;
    const pagM = Math.max(saldo * pagoMinPct, PAGO_MINIMO_PISO_RD);
    if (pagM <= intM + EPSILON_NO_AMORTIZA) { intAnual = Infinity; break; }
    const capM = Math.max(0, pagM - intM);
    intAnual += intM;
    saldo -= capM;
  }

  let saldoPay = cc.usedRD;
  let totalIntFull = 0;
  let mesesFull = 0;
  while (saldoPay > 1 && mesesFull < 360) {
    const iF = saldoPay * tasaMens;
    const pF = Math.max(saldoPay * pagoMinPct, PAGO_MINIMO_PISO_RD);
    if (pF <= iF + EPSILON_NO_AMORTIZA) { mesesFull = Infinity; break; }
    totalIntFull += iF;
    saldoPay -= (pF - iF);
    mesesFull++;
  }
  return { intAnual, totalIntFull, mesesFull };
}

async function renderSalud(body, viewEl, cards) {
  if (cards.length === 0) {
    body.innerHTML = '<div class="card"><p class="empty-state">Registra una tarjeta para ver su salud crediticia</p></div>';
    return;
  }

  const month = currentMonthKey();
  const tendencia = await apiGet(`/api/cards/tendencia?month=${month}`).catch(() => []);
  const tendMap = new Map(tendencia.map((t) => [t.key, t]));

  const deudaTotal = cards.reduce((a, c) => a + c.deudaTotalRD, 0);
  const intMesTotal = cards.reduce((a, c) => a + (Math.max(0, c.usedRD) * (c.tasaInteres / 100 / 12)), 0);
  const pagoMinTotal = cards.reduce((a, c) => a + c.pagoMinimoTotalRD, 0);
  const usoGlobal = cards.reduce((a, c) => a + c.limitRD, 0) > 0
    ? (cards.reduce((a, c) => a + c.usedRD, 0) / cards.reduce((a, c) => a + c.limitRD, 0)) * 100
    : 0;

  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Deuda total</div><div class="kpi-value neg">${fmtRD(deudaTotal)}</div></div>
      <div class="kpi"><div class="kpi-label">% Uso global</div><div class="kpi-value">${usoGlobal.toFixed(1)}%${overLimitBadge(usoGlobal)}</div></div>
      <div class="kpi"><div class="kpi-label">Intereses este mes</div><div class="kpi-value">${fmtRD(intMesTotal)}</div></div>
      <div class="kpi"><div class="kpi-label">Pago mínimo total</div><div class="kpi-value">${fmtRD(pagoMinTotal)}</div></div>
    </div>

    <div class="card">
      <h2>Comparativa por tarjeta</h2>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Tarjeta</th><th class="right">Saldo</th><th class="right">Límite</th><th class="right">Uso</th>
          <th class="right">Int. mes</th><th class="right">Pago mín.</th><th>Día pago</th><th>Día corte</th><th>Estado</th>
        </tr></thead>
        <tbody>
          ${cards.map((c) => {
            const intMes = c.usedRD * (c.tasaInteres / 100 / 12);
            const estado = c.usoPctRD > 100
              ? '<span class="badge badge-danger">⚠ Límite superado</span>'
              : (c.alertaRD && c.usedRD >= c.alertaRD ? '<span class="badge badge-warn">⚠ Alerta</span>' : '<span class="badge badge-ok">✓ Normal</span>');
            return `<tr>
              <td>${esc(c.label)}</td>
              <td class="right">${fmtRD(c.usedRD)}</td>
              <td class="right">${fmtRD(c.limitRD)}</td>
              <td class="right">${c.usoPctRD}%</td>
              <td class="right">${fmtRD(intMes)}</td>
              <td class="right">${fmtRD(c.pagoMinimoTotalRD)}</td>
              <td>${c.diaPago}</td>
              <td>${c.diaCorte}</td>
              <td>${estado}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>Proyección pagando solo el mínimo</h2>
      <p class="muted small">Qué pasa si solo pagas el pago mínimo cada mes, sin nuevos consumos.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Tarjeta</th><th class="right">Interés 12 meses</th><th class="right">Interés total hasta liquidar</th><th>Tiempo para liquidar</th></tr></thead>
        <tbody>
          ${cards.filter((c) => c.usedRD > 0).map((c) => {
            const p = proyeccion12m(c);
            const infinito = !Number.isFinite(p.mesesFull);
            return `<tr>
              <td>${esc(c.label)}</td>
              <td class="right">${fmtRD(p.intAnual)}</td>
              <td class="right ${infinito ? 'neg' : ''}">${infinito ? '∞' : fmtRD(p.totalIntFull)}</td>
              <td class="${infinito ? 'neg' : ''}">${infinito
                ? '⚠ Nunca se liquida — el mínimo no cubre el interés'
                : `${p.mesesFull} meses (${(p.mesesFull / 12).toFixed(1)} años)`}</td>
            </tr>`;
          }).join('')}
          ${cards.every((c) => c.usedRD <= 0) ? '<tr><td colspan="4" class="empty-state">Sin saldo pendiente en RD$</td></tr>' : ''}
        </tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>Tendencia: mes actual vs anterior</h2>
      ${cards.map((c) => {
        const t = tendMap.get(c.key) || { mesActual: 0, mesAnterior: 0 };
        const max = Math.max(t.mesActual, t.mesAnterior, 1);
        const delta = t.mesAnterior > 0 ? ((t.mesActual - t.mesAnterior) / t.mesAnterior) * 100 : (t.mesActual > 0 ? 100 : 0);
        return `
          <div style="margin-bottom:0.9rem">
            <div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:0.25rem">
              <span>${esc(c.label)}</span>
              <span class="${delta > 0 ? 'neg' : 'pos'}">${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(0)}%</span>
            </div>
            <div class="small muted">Este mes: ${fmtRD(t.mesActual)} · Mes anterior: ${fmtRD(t.mesAnterior)}</div>
            <div class="progress"><i style="width:${(t.mesActual / max) * 100}%;background:var(--accent)"></i></div>
            <div class="progress"><i style="width:${(t.mesAnterior / max) * 100}%;background:var(--muted)"></i></div>
          </div>`;
      }).join('')}
    </div>
  `;
}
