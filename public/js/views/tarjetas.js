import { apiGet, apiPost, apiPut, apiDelete } from '../api.js';
import { esc, toast, confirmDialog, openModal, progressBar, overLimitBadge } from '../ui.js';
import { fmtRD, fmtUSD, fmtFechaDDMM, todayISO } from '../format.js';

export async function render(el) {
  const cards = await apiGet('/api/cards');
  const totalDeuda = cards.reduce((a, c) => a + c.deudaTotalRD, 0);
  const totalPagoMin = cards.reduce((a, c) => a + c.pagoMinimoTotalRD, 0);

  el.innerHTML = `
    <div class="section-head">
      <h1>Tarjetas de crédito</h1>
      <button id="add-card" class="btn btn-primary">＋ Nueva tarjeta</button>
    </div>

    ${cards.length > 1 ? `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Deuda consolidada</div><div class="kpi-value neg">${fmtRD(totalDeuda)}</div></div>
      <div class="kpi"><div class="kpi-label">Pago mínimo consolidado</div><div class="kpi-value">${fmtRD(totalPagoMin)}</div></div>
      <div class="kpi"><div class="kpi-label">Tarjetas</div><div class="kpi-value">${cards.length}</div></div>
    </div>` : ''}

    ${cards.length === 0 ? '<div class="card"><p class="empty-state">Registra tu primera tarjeta para empezar a controlarla</p></div>' : `
    <div class="cc-grid">
      ${cards.map((c) => `
        <div class="cc-card">
          <div class="cc-head">
            <strong>${esc(c.label)}</strong>
            <span class="cc-meta">${esc(c.bank || '')} ${esc(c.red || '')}</span>
          </div>
          <div class="cc-meta">${esc(c.producto || '')}</div>

          <div style="margin-top:0.6rem">
            <div class="small">RD$ · ${fmtRD(c.usedRD)} / ${fmtRD(c.limitRD)} <span class="muted">(${c.usoPctRD}%)</span> ${overLimitBadge(c.usoPctRD)}</div>
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
  `;

  el.querySelector('#add-card').onclick = () => openCardForm(el, null);

  el.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => openCardForm(el, cards.find((c) => c.id === Number(b.dataset.edit)));
  });

  el.querySelectorAll('[data-del]').forEach((b) => {
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
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  el.querySelectorAll('[data-pay]').forEach((b) => {
    const card = cards.find((c) => c.id === Number(b.dataset.pay));
    b.onclick = () => openPayForm(el, card);
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
