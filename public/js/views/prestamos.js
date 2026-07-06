import { apiGet, apiPost, apiDelete } from '../api.js';
import { esc, toast, confirmDialog, openModal, progressBar } from '../ui.js';
import { fmtRD, fmtFechaDDMM, todayISO } from '../format.js';

export async function render(el) {
  const loans = await apiGet('/api/loans');
  const totalSaldo = loans.reduce((a, l) => a + (l.saldado ? 0 : l.saldoPendiente), 0);
  const totalCuotas = loans.reduce((a, l) => a + (l.saldado || !l.activo ? 0 : l.cuotaMensual), 0);

  el.innerHTML = `
    <div class="section-head">
      <h1>Préstamos</h1>
      <button id="add-loan" class="btn btn-primary">＋ Nuevo préstamo</button>
    </div>

    ${loans.length > 0 ? `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Saldo pendiente total</div><div class="kpi-value neg">${fmtRD(totalSaldo)}</div></div>
      <div class="kpi"><div class="kpi-label">Cuotas mensuales</div><div class="kpi-value">${fmtRD(totalCuotas)}</div></div>
      <div class="kpi"><div class="kpi-label">Préstamos</div><div class="kpi-value">${loans.length}</div></div>
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
              <td>${esc(l.nombre)}${l.saldado ? ' <span class="badge badge-ok">saldado</span>' : ''}</td>
              <td class="muted">${esc(l.banco || '')}</td>
              <td class="right">${fmtRD(l.cuotaMensual)}</td>
              <td class="right ${l.saldado ? 'pos' : 'neg'}">${fmtRD(l.saldoPendiente)}</td>
              <td style="min-width:140px">
                <span class="small muted">${l.cuotasPagadas}/${l.plazoMeses} cuotas</span>
                ${progressBar(l.progresoPct)}
              </td>
              <td class="muted">${l.proximaCuotaFecha ? fmtFechaDDMM(l.proximaCuotaFecha) : '—'}</td>
              <td>
                ${!l.saldado ? `<button class="btn btn-sm btn-success" data-pay="${l.id}">Pagar cuota</button>` : ''}
                <button class="btn btn-sm btn-ghost" data-del="${l.id}" title="Eliminar">🗑</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>
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
}

function openLoanForm(viewEl) {
  const m = openModal(`
    <h2>Nuevo préstamo</h2>
    <form id="loan-form" class="form-grid">
      <label class="full">Nombre<input type="text" name="nombre" required placeholder="Préstamo vehículo"></label>
      <label>Banco<input type="text" name="banco" placeholder="Popular, BHD…"></label>
      <label>Monto original RD$<input type="number" name="original" step="0.01" min="1" required></label>
      <label>Tasa % anual<input type="number" name="tasaAnual" step="0.01" min="0" required></label>
      <label>Plazo (meses)<input type="number" name="plazoMeses" min="1" required></label>
      <label>Día de pago<input type="number" name="diaPago" min="1" max="31" required></label>
      <label>Fecha de inicio<input type="date" name="fechaInicio" value="${todayISO()}" required></label>
    </form>
    <p class="muted small" id="cuota-preview">Cuota mensual estimada: —</p>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn btn-primary" data-act="save">Crear préstamo</button>
    </div>
  `);

  // Vista previa de la cuota (misma fórmula francesa del servidor)
  const form = m.el.querySelector('#loan-form');
  const preview = () => {
    const P = Number(form.original.value);
    const t = Number(form.tasaAnual.value);
    const n = Number(form.plazoMeses.value);
    const out = m.el.querySelector('#cuota-preview');
    if (P > 0 && n > 0 && t >= 0) {
      const i = t / 100 / 12;
      const cuota = i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n));
      out.textContent = `Cuota mensual estimada: ${fmtRD(cuota)}`;
    } else {
      out.textContent = 'Cuota mensual estimada: —';
    }
  };
  form.addEventListener('input', preview);

  m.el.querySelector('[data-act="cancel"]').onclick = m.close;
  m.el.querySelector('[data-act="save"]').onclick = async () => {
    const f = new FormData(form);
    try {
      const loan = await apiPost('/api/loans', {
        nombre: f.get('nombre'),
        banco: f.get('banco') || undefined,
        original: Number(f.get('original')),
        tasaAnual: Number(f.get('tasaAnual')),
        plazoMeses: Number(f.get('plazoMeses')),
        diaPago: Number(f.get('diaPago')),
        fechaInicio: f.get('fechaInicio')
      });
      m.close();
      toast(`Préstamo creado — cuota ${fmtRD(loan.cuotaMensual)}`, 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
