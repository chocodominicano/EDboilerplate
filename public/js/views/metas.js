import { apiGet, apiPost, apiPut, apiDelete } from '../api.js';
import { esc, toast, confirmDialog, openModal } from '../ui.js';
import { fmtRD, fmtMoney, fmtFechaDDMM, todayISO } from '../format.js';
import { attachMoney, moneyToNum, moneyStr } from '../money.js';
import { ACCENT_COLORS } from '../colors.js';

const ICONOS = ['🎯', '✈️', '🏠', '🚗', '📱', '🎓', '🏥', '🛡️', '💰'];
const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const SALUD = {
  ok: { color: 'var(--green)', label: '✓ En buen ritmo' },
  warn: { color: 'var(--amber)', label: '⚠ Un poco atrás' },
  late: { color: 'var(--red)', label: '🚨 Ritmo insuficiente' }
};

export async function render(el) {
  const [goals, resumen] = await Promise.all([
    apiGet('/api/goals'),
    apiGet('/api/goals/resumen')
  ]);
  const historiales = await Promise.all(goals.map((g) => apiGet(`/api/goals/${g.id}/abonos`)));
  const histMap = new Map(goals.map((g, i) => [g.id, historiales[i]]));

  el.innerHTML = `
    <div class="section-head">
      <h1>🎯 Metas de ahorro</h1>
      <button id="add-goal" class="btn btn-primary">＋ Nueva meta</button>
    </div>

    ${goals.length > 0 ? kpisHTML(resumen) : ''}

    ${goals.length === 0
      ? '<div class="card"><p class="empty-state">Crea tu primera meta financiera →</p></div>'
      : goals.map((g) => cardHTML(g, histMap.get(g.id))).join('')}
  `;

  el.querySelector('#add-goal').onclick = () => openGoalForm(el, null);
  bindGoalCards(el, goals);
}

// ─── KPIs ────────────────────────────────────────────────────

function kpisHTML(r) {
  return `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Total a ahorrar</div><div class="kpi-value">${fmtRD(r.totalObjetivoRD)}</div><div class="kpi-sub">${r.totalMetas} meta(s)</div></div>
      <div class="kpi"><div class="kpi-label">Total ahorrado</div><div class="kpi-value pos">${fmtRD(r.totalAhorradoRD)}</div><div class="kpi-sub">${r.pctAhorradoGlobal}% del total</div></div>
      <div class="kpi"><div class="kpi-label">Pendiente</div><div class="kpi-value" style="color:var(--amber)">${fmtRD(r.totalFaltaRD)}</div><div class="kpi-sub">por alcanzar</div></div>
      <div class="kpi"><div class="kpi-label">Completadas</div><div class="kpi-value">${r.metasCompletas}</div><div class="kpi-sub">de ${r.totalMetas} meta(s)</div></div>
    </div>`;
}

// ─── Card de meta ────────────────────────────────────────────

function historialHTML(hist, g) {
  if (!hist || hist.porMes.length === 0) return '';
  const max = Math.max(...hist.porMes.map((m) => m.total), 1);
  // Barras y etiquetas en filas separadas: dentro de un mismo flex item
  // con align-items:flex-end el label robaba altura de la columna y las
  // barras (height:%) colapsaban contra ese alto reducido — con la fila
  // de gráfico aislada a 48px las barras vuelven a escalar correctamente.
  return `
    <div style="margin-top:0.75rem">
      <div class="muted small" style="margin-bottom:0.3rem">Aportes por mes</div>
      <div style="display:flex;gap:0.25rem;height:48px">
        ${hist.porMes.map((m) => {
          const h = Math.max(3, Math.round((m.total / max) * 100));
          return `
          <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
            <div style="width:100%;background:${g.color};border-radius:3px 3px 0 0;height:${h}%;min-height:3px;opacity:0.85"
              title="${esc(m.mes)}: ${fmtMoney(m.total, g.moneda)}"></div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:0.25rem;margin-top:0.2rem">
        ${hist.porMes.map((m) => {
          const mesNum = Number(m.mes.slice(5, 7));
          return `<div style="flex:1;text-align:center;font-size:0.65rem;color:var(--muted)">${MESES_ABR[mesNum - 1]}</div>`;
        }).join('')}
      </div>
    </div>`;
}

function chipHTML(label, valor) {
  return `
    <div style="background:var(--panel-2);border-radius:8px;padding:0.4rem;text-align:center">
      <div class="muted" style="font-size:0.7rem">${label}</div>
      <div style="font-weight:600;font-size:0.85rem">${valor}</div>
    </div>`;
}

function cardHTML(g, hist) {
  const salud = SALUD[g.salud];
  const cuota = (n) => fmtMoney(n, g.moneda);

  return `
    <div class="card" style="border-left:3px solid ${g.color}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;flex-wrap:wrap">
        <div>
          <strong style="font-size:1.05rem">${g.icono} ${esc(g.nombre)}</strong>
          <div class="muted small">${cuota(g.actual)} de ${cuota(g.objetivo)} · vence ${fmtFechaDDMM(g.fechaLimite)}</div>
        </div>
        ${!g.completada ? `<span class="badge" style="background:${salud.color}22;border:1px solid ${salud.color}44;color:${salud.color}">${salud.label}</span>` : ''}
      </div>

      <div style="margin-top:0.75rem;position:relative">
        <div class="progress" style="height:8px"><i style="width:${g.pct}%;background:${g.color}"></i></div>
        <div style="position:absolute;top:-2px;left:${Math.min(100, g.pctTiempo)}%;width:2px;height:12px;background:var(--amber);border-radius:1px"
          title="Tiempo transcurrido: ${g.pctTiempo}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--muted);margin-top:0.2rem">
        <span>${g.pct}% dinero ahorrado</span>
        <span>▲ ${g.pctTiempo}% tiempo transcurrido</span>
      </div>

      ${g.completada ? `
        <div style="text-align:center;color:var(--green);font-weight:600;padding:0.6rem 0;margin-top:0.6rem">🎉 ¡Meta alcanzada!</div>
      ` : `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-top:0.75rem">
          ${chipHTML('Por día', cuota(g.cadencia.porDia))}
          ${chipHTML('Semanal', cuota(g.cadencia.porSemana))}
          ${chipHTML('Quincena', cuota(g.cadencia.porQuincena))}
          ${chipHTML('Mensual', cuota(g.cadencia.porMes))}
        </div>

        <div class="small" style="margin-top:0.6rem;color:${g.proyeccion ? (g.proyeccion.aTiempo ? 'var(--green)' : 'var(--amber)') : 'var(--muted)'}">
          ${g.proyeccion
            ? `A tu ritmo actual (${cuota(g.ritmoActual)}/día): llegas el ${fmtFechaDDMM(g.proyeccion.fecha)}
               ${g.proyeccion.aTiempo ? '✓' : `(${g.proyeccion.dias - g.diasLeft} días después)`}`
            : 'A tu ritmo actual: sin datos suficientes aún'}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem">
          <span class="small">Faltan <strong>${cuota(g.falta)}</strong></span>
          <div style="display:flex;gap:0.4rem">
            <input type="text" data-abono-input="${g.id}" inputmode="decimal" placeholder="0.00" style="width:130px">
            <button class="btn btn-ghost btn-sm" data-abonar="${g.id}">+ Abonar</button>
          </div>
        </div>
      `}

      ${historialHTML(hist, g)}

      <div class="cc-actions" style="margin-top:0.75rem">
        <button class="btn btn-sm" data-edit="${g.id}">✏️ Editar</button>
        <button class="btn btn-sm btn-ghost" data-del="${g.id}" title="Eliminar">🗑</button>
      </div>
    </div>`;
}

function bindGoalCards(el, goals) {
  el.querySelectorAll('[data-abono-input]').forEach((input) => attachMoney(input));

  el.querySelectorAll('[data-abonar]').forEach((btn) => {
    const g = goals.find((x) => x.id === Number(btn.dataset.abonar));
    const input = el.querySelector(`[data-abono-input="${g.id}"]`);
    const doAbonar = async () => {
      const monto = moneyToNum(input);
      if (monto <= 0) return toast('Ingresa el monto a abonar', 'error');
      try {
        await apiPost(`/api/goals/${g.id}/abonar`, { monto, fechaSort: todayISO() });
        toast(`${fmtMoney(monto, g.moneda)} abonado a "${g.nombre}"`, 'success');
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    btn.onclick = doAbonar;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doAbonar(); }
    });
  });

  el.querySelectorAll('[data-edit]').forEach((btn) => {
    const g = goals.find((x) => x.id === Number(btn.dataset.edit));
    btn.onclick = () => openGoalForm(el, g);
  });

  el.querySelectorAll('[data-del]').forEach((btn) => {
    const g = goals.find((x) => x.id === Number(btn.dataset.del));
    btn.onclick = async () => {
      const ok = await confirmDialog(
        `¿Eliminar la meta <strong>${esc(g.nombre)}</strong>? Los abonos ya registrados se conservan como gastos.`,
        { danger: true, okLabel: 'Eliminar' }
      );
      if (!ok) return;
      try {
        await apiDelete(`/api/goals/${g.id}`);
        render(el);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}

// ─── Alta / edición (modal compartido) ──────────────────────

function openGoalForm(viewEl, goal) {
  const isEdit = !!goal;
  const iconoDefault = isEdit ? goal.icono : ICONOS[0];
  const colorDefault = isEdit ? goal.color : ACCENT_COLORS[0];

  const m = openModal(`
    <h2>${isEdit ? `Editar ${esc(goal.nombre)}` : 'Nueva meta'}</h2>
    <form id="goal-form" class="form-grid">
      <label class="full">Nombre<input type="text" name="nombre" required value="${isEdit ? esc(goal.nombre) : ''}" placeholder="Vacaciones Punta Cana"></label>
      <label>Moneda
        <select name="moneda" ${isEdit ? 'disabled' : ''}>
          <option value="RD$" ${!isEdit || goal.moneda === 'RD$' ? 'selected' : ''}>RD$</option>
          <option value="USD$" ${isEdit && goal.moneda === 'USD$' ? 'selected' : ''}>USD$</option>
        </select>
      </label>
      <label>Objetivo<input type="text" name="objetivo" inputmode="decimal" required value="${isEdit ? moneyStr(goal.objetivo) : ''}" placeholder="50,000.00"></label>
      ${!isEdit ? '<label>Ya ahorrado (opcional)<input type="text" name="actual" inputmode="decimal" placeholder="0.00"></label>' : ''}
      <label>Fecha límite<input type="date" name="fechaLimite" required value="${isEdit ? esc(goal.fechaLimite) : ''}"></label>
      <label>Fecha de inicio <span class="muted small">(para calcular el ritmo)</span>
        <input type="date" name="fechaInicio" value="${isEdit ? esc(goal.fechaInicio) : todayISO()}"></label>
      <label class="full">Ícono
        <div id="icon-picker" style="display:flex;gap:0.4rem;margin-top:0.3rem;flex-wrap:wrap">
          ${ICONOS.map((i) => `<button type="button" class="icon-swatch" data-icono="${i}"
            style="width:36px;height:36px;border-radius:8px;background:var(--panel-2);
            border:2px solid ${iconoDefault === i ? 'var(--accent)' : 'transparent'};cursor:pointer;font-size:1.1rem">${i}</button>`).join('')}
        </div>
        <input type="hidden" name="icono" value="${iconoDefault}">
      </label>
      <label class="full">Color
        <div id="color-picker" style="display:flex;gap:0.5rem;margin-top:0.3rem">
          ${ACCENT_COLORS.map((c) => `<button type="button" class="color-swatch" data-color="${c}"
            style="width:28px;height:28px;border-radius:50%;background:${c};
            border:2px solid ${colorDefault === c ? '#fff' : 'transparent'};cursor:pointer"></button>`).join('')}
        </div>
        <input type="hidden" name="color" value="${colorDefault}">
      </label>
    </form>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn btn-primary" data-act="save">${isEdit ? 'Guardar cambios' : 'Crear meta'}</button>
    </div>
  `);

  const form = m.el.querySelector('#goal-form');
  attachMoney(form.objetivo);
  if (!isEdit) attachMoney(form.actual);

  m.el.querySelectorAll('.icon-swatch').forEach((btn) => {
    btn.onclick = () => {
      form.icono.value = btn.dataset.icono;
      m.el.querySelectorAll('.icon-swatch').forEach((b) => { b.style.borderColor = 'transparent'; });
      btn.style.borderColor = 'var(--accent)';
    };
  });
  m.el.querySelectorAll('.color-swatch').forEach((btn) => {
    btn.onclick = () => {
      form.color.value = btn.dataset.color;
      m.el.querySelectorAll('.color-swatch').forEach((b) => { b.style.borderColor = 'transparent'; });
      btn.style.borderColor = '#fff';
    };
  });

  m.el.querySelector('[data-act="cancel"]').onclick = m.close;
  m.el.querySelector('[data-act="save"]').onclick = async () => {
    const fechaLimite = form.fechaLimite.value;
    if (!fechaLimite) return toast('Selecciona una fecha límite', 'error');
    const payload = {
      nombre: form.nombre.value.trim(),
      objetivo: moneyToNum(form.objetivo),
      fechaLimite,
      fechaInicio: form.fechaInicio.value || undefined,
      icono: form.icono.value,
      color: form.color.value
    };
    if (!isEdit) {
      payload.moneda = form.moneda.value;
      payload.actual = moneyToNum(form.actual);
    }
    try {
      if (isEdit) await apiPut(`/api/goals/${goal.id}`, payload);
      else await apiPost('/api/goals', payload);
      m.close();
      toast(isEdit ? 'Meta actualizada' : `Meta "${payload.nombre}" creada`, 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
