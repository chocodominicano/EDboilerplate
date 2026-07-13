const express = require('express');
const db = require('../db/database');
const { isValidFechaSort, isValidMonthKey, currentMonthKey, todayLocalISO, dateInMonth, quincenaOf, quincenaOfDay } = require('../lib/dates');

const router = express.Router();

function parseMeses(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Estado de un compromiso fijo para un mes dado:
// pagado (mes marcado) / vencido (el día ya pasó) / pendiente
function estadoDe(meses, month, dia) {
  if (meses.includes(month)) return 'pagado';
  const hoy = todayLocalISO();
  const fecha = dateInMonth(month, dia);
  return fecha < hoy ? 'vencido' : 'pendiente';
}

function validateBase(b, campoNombre) {
  const nombre = String(b[campoNombre] || '').trim();
  if (!nombre) return { error: `${campoNombre} es requerido` };
  const monto = Number(b.monto);
  if (!Number.isFinite(monto) || monto <= 0) return { error: 'monto debe ser mayor que 0' };
  const dia = Number(b.dia);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) return { error: 'dia debe ser 1-31' };
  return { nombre, monto, dia };
}

// ─── Gastos fijos ───────────────────────────────────────────────

router.get('/fixed-expenses', (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  const rows = db.prepare('SELECT * FROM fixed_expenses WHERE user_id = ? ORDER BY dia').all(req.user.id);
  res.json(rows.map((r) => {
    const meses = parseMeses(r.pagados_meses);
    return {
      id: r.id,
      concepto: r.concepto,
      monto: r.monto,
      dia: r.dia,
      cat: r.cat,
      metodo: r.metodo,
      activo: !!r.activo,
      quincena: quincenaOfDay(r.dia),
      month,
      estado: r.activo ? estadoDe(meses, month, r.dia) : 'inactivo',
      pagadosMeses: meses
    };
  }));
});

router.post('/fixed-expenses', (req, res) => {
  const b = req.body || {};
  const v = validateBase(b, 'concepto');
  if (v.error) return res.status(400).json({ error: v.error });
  const info = db.prepare(
    'INSERT INTO fixed_expenses (user_id, concepto, monto, dia, cat, metodo) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, v.nombre, v.monto, v.dia, b.cat ? String(b.cat) : null, b.metodo ? String(b.metodo) : null);
  res.status(201).json({ id: info.lastInsertRowid, ok: true });
});

router.put('/fixed-expenses/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE user_id = ? AND id = ?').get(req.user.id, Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Gasto fijo no existe' });
  const b = req.body || {};
  const v = validateBase({ concepto: b.concepto ?? row.concepto, monto: b.monto ?? row.monto, dia: b.dia ?? row.dia }, 'concepto');
  if (v.error) return res.status(400).json({ error: v.error });
  db.prepare('UPDATE fixed_expenses SET concepto=?, monto=?, dia=?, cat=?, metodo=?, activo=? WHERE user_id=? AND id=?')
    .run(v.nombre, v.monto, v.dia,
      b.cat !== undefined ? (b.cat ? String(b.cat) : null) : row.cat,
      b.metodo !== undefined ? (b.metodo ? String(b.metodo) : null) : row.metodo,
      b.activo !== undefined ? (b.activo ? 1 : 0) : row.activo,
      req.user.id, row.id);
  res.json({ ok: true });
});

router.delete('/fixed-expenses/:id', (req, res) => {
  const info = db.prepare('DELETE FROM fixed_expenses WHERE user_id = ? AND id = ?').run(req.user.id, Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Gasto fijo no existe' });
  res.json({ ok: true });
});

// Marca el mes como pagado y registra el gasto real vinculado
router.post('/fixed-expenses/:id/pay', (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE user_id = ? AND id = ?').get(req.user.id, Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Gasto fijo no existe' });

  const b = req.body || {};
  const month = b.month && isValidMonthKey(b.month) ? b.month : currentMonthKey();
  const meses = parseMeses(row.pagados_meses);
  if (meses.includes(month)) return res.status(409).json({ error: `Ya está pagado en ${month}` });

  const fechaSort = b.fechaSort && isValidFechaSort(b.fechaSort) ? b.fechaSort : dateInMonth(month, row.dia);

  const pay = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (user_id, nombre, cat, metodo, monto_num, moneda, neg,
                                fecha_sort, quincena, fixed_expense_id)
      VALUES (?, ?, ?, ?, ?, 'RD$', 1, ?, ?, ?)
    `).run(req.user.id, row.concepto, row.cat || 'Gastos fijos', row.metodo,
      row.monto, fechaSort, quincenaOf(fechaSort), row.id);
    meses.push(month);
    db.prepare('UPDATE fixed_expenses SET pagados_meses = ? WHERE id = ?').run(JSON.stringify(meses), row.id);
  });
  pay();
  res.status(201).json({ ok: true, month });
});

// ─── Ingresos fijos ─────────────────────────────────────────────

router.get('/fixed-incomes', (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  const rows = db.prepare('SELECT * FROM fixed_incomes WHERE user_id = ? ORDER BY dia').all(req.user.id);
  res.json(rows.map((r) => {
    const meses = parseMeses(r.recibidos_meses);
    return {
      id: r.id,
      descripcion: r.descripcion,
      monto: r.monto,
      dia: r.dia,
      cuenta: r.cuenta,
      activo: !!r.activo,
      quincena: quincenaOfDay(r.dia),
      month,
      recibido: meses.includes(month),
      recibidosMeses: meses
    };
  }));
});

router.post('/fixed-incomes', (req, res) => {
  const b = req.body || {};
  const v = validateBase(b, 'descripcion');
  if (v.error) return res.status(400).json({ error: v.error });
  const info = db.prepare(
    'INSERT INTO fixed_incomes (user_id, descripcion, monto, dia, cuenta) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, v.nombre, v.monto, v.dia, b.cuenta ? String(b.cuenta) : null);
  res.status(201).json({ id: info.lastInsertRowid, ok: true });
});

router.put('/fixed-incomes/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_incomes WHERE user_id = ? AND id = ?').get(req.user.id, Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Ingreso fijo no existe' });
  const b = req.body || {};
  const v = validateBase({ descripcion: b.descripcion ?? row.descripcion, monto: b.monto ?? row.monto, dia: b.dia ?? row.dia }, 'descripcion');
  if (v.error) return res.status(400).json({ error: v.error });
  db.prepare('UPDATE fixed_incomes SET descripcion=?, monto=?, dia=?, cuenta=?, activo=? WHERE user_id=? AND id=?')
    .run(v.nombre, v.monto, v.dia,
      b.cuenta !== undefined ? (b.cuenta ? String(b.cuenta) : null) : row.cuenta,
      b.activo !== undefined ? (b.activo ? 1 : 0) : row.activo,
      req.user.id, row.id);
  res.json({ ok: true });
});

router.delete('/fixed-incomes/:id', (req, res) => {
  const info = db.prepare('DELETE FROM fixed_incomes WHERE user_id = ? AND id = ?').run(req.user.id, Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Ingreso fijo no existe' });
  res.json({ ok: true });
});

// "Marcar como recibido" (Radar): registra el ingreso real del mes.
// Idempotente por mes: 409 si ya fue recibido.
router.post('/fixed-incomes/:id/receive', (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_incomes WHERE user_id = ? AND id = ?').get(req.user.id, Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Ingreso fijo no existe' });

  const b = req.body || {};
  const month = b.month && isValidMonthKey(b.month) ? b.month : currentMonthKey();
  const meses = parseMeses(row.recibidos_meses);
  if (meses.includes(month)) return res.status(409).json({ error: `Ya está recibido en ${month}` });

  const fechaSort = b.fechaSort && isValidFechaSort(b.fechaSort) ? b.fechaSort : dateInMonth(month, row.dia);

  const receive = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (user_id, nombre, cat, monto_num, moneda, neg,
                                fecha_sort, quincena, fuente, cuenta, fixed_income_id)
      VALUES (?, ?, 'Ingresos', ?, 'RD$', 0, ?, ?, ?, ?, ?)
    `).run(req.user.id, row.descripcion, row.monto, fechaSort, quincenaOf(fechaSort),
      'Ingreso fijo', row.cuenta, row.id);
    meses.push(month);
    db.prepare('UPDATE fixed_incomes SET recibidos_meses = ? WHERE id = ?').run(JSON.stringify(meses), row.id);
  });
  receive();
  res.status(201).json({ ok: true, month });
});

module.exports = router;
