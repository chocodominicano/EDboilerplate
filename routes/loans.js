const express = require('express');
const db = require('../db/database');
const { isValidFechaSort, todayLocalISO, quincenaOf, addMonthsToKey, dateInMonth, monthKey } = require('../lib/dates');
const { frenchPayment, splitCuota, round2 } = require('../lib/amortization');

const router = express.Router();

const findById = db.prepare('SELECT * FROM loans WHERE user_id = ? AND id = ?');
const listStmt = db.prepare('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at');

function serializeLoan(row) {
  // La primera cuota vence un mes después del inicio, en el día de pago
  const nextKey = addMonthsToKey(monthKey(row.fecha_inicio), row.cuotas_pagadas + 1);
  return {
    id: row.id,
    nombre: row.nombre,
    banco: row.banco,
    original: row.original,
    tasaAnual: row.tasa_anual,
    plazoMeses: row.plazo_meses,
    cuotaMensual: row.cuota_mensual,
    diaPago: row.dia_pago,
    fechaInicio: row.fecha_inicio,
    saldoPendiente: row.saldo_pendiente,
    cuotasPagadas: row.cuotas_pagadas,
    activo: !!row.activo,
    saldado: row.saldo_pendiente <= 0,
    progresoPct: round2((row.cuotas_pagadas / row.plazo_meses) * 100),
    proximaCuotaFecha: row.saldo_pendiente > 0 ? dateInMonth(nextKey, row.dia_pago) : null
  };
}

router.get('/', (req, res) => {
  res.json(listStmt.all(req.user.id).map(serializeLoan));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

  const original = Number(b.original);
  const tasaAnual = Number(b.tasaAnual);
  const plazoMeses = Number(b.plazoMeses);
  const diaPago = Number(b.diaPago);
  if (!Number.isFinite(original) || original <= 0) return res.status(400).json({ error: 'original debe ser mayor que 0' });
  if (!Number.isFinite(tasaAnual) || tasaAnual < 0) return res.status(400).json({ error: 'tasaAnual inválida' });
  if (!Number.isInteger(plazoMeses) || plazoMeses <= 0) return res.status(400).json({ error: 'plazoMeses debe ser entero positivo' });
  if (!Number.isInteger(diaPago) || diaPago < 1 || diaPago > 31) return res.status(400).json({ error: 'diaPago debe ser 1-31' });
  const fechaInicio = b.fechaInicio || todayLocalISO();
  if (!isValidFechaSort(fechaInicio)) return res.status(400).json({ error: 'fechaInicio inválida (yyyy-mm-dd)' });

  const cuota = round2(frenchPayment(original, tasaAnual, plazoMeses));
  const info = db.prepare(`
    INSERT INTO loans (user_id, nombre, banco, original, tasa_anual, plazo_meses,
                       cuota_mensual, dia_pago, fecha_inicio, saldo_pendiente)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, nombre, b.banco ? String(b.banco) : null, original, tasaAnual,
    plazoMeses, cuota, diaPago, fechaInicio, original);

  res.status(201).json(serializeLoan(findById.get(req.user.id, info.lastInsertRowid)));
});

// Pago de cuota: separa interés/capital sobre el saldo actual; el saldo
// baja SOLO por el capital. La transacción sí es un gasto (neg=1).
router.post('/:id/pay', (req, res) => {
  const loan = findById.get(req.user.id, Number(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Préstamo no existe' });
  if (loan.saldo_pendiente <= 0) return res.status(400).json({ error: 'El préstamo ya está saldado' });

  const fechaSort = (req.body && req.body.fechaSort) || todayLocalISO();
  if (!isValidFechaSort(fechaSort)) return res.status(400).json({ error: 'fechaSort inválido (yyyy-mm-dd)' });

  const { interes, capital } = splitCuota(loan.saldo_pendiente, loan.tasa_anual, loan.cuota_mensual);
  const montoPagado = round2(interes + capital);

  const pay = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (user_id, nombre, cat, metodo, monto_num, moneda, neg,
                                is_pago_prestamo, fecha_sort, quincena, loan_id)
      VALUES (?, ?, 'Préstamos', ?, ?, 'RD$', 1, 1, ?, ?, ?)
    `).run(req.user.id, `Cuota ${loan.nombre}`, loan.banco || 'Banco',
      montoPagado, fechaSort, quincenaOf(fechaSort), loan.id);

    const nuevoSaldo = round2(Math.max(0, loan.saldo_pendiente - capital));
    db.prepare('UPDATE loans SET saldo_pendiente = ?, cuotas_pagadas = cuotas_pagadas + 1 WHERE id = ?')
      .run(nuevoSaldo, loan.id);
  });
  pay();

  res.status(201).json({
    ok: true,
    pago: { interes, capital, total: montoPagado },
    loan: serializeLoan(findById.get(req.user.id, loan.id))
  });
});

router.put('/:id', (req, res) => {
  const loan = findById.get(req.user.id, Number(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Préstamo no existe' });
  const b = req.body || {};

  const nombre = b.nombre !== undefined ? String(b.nombre).trim() : loan.nombre;
  if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
  const banco = b.banco !== undefined ? (b.banco ? String(b.banco) : null) : loan.banco;
  let diaPago = loan.dia_pago;
  if (b.diaPago !== undefined) {
    diaPago = Number(b.diaPago);
    if (!Number.isInteger(diaPago) || diaPago < 1 || diaPago > 31) return res.status(400).json({ error: 'diaPago debe ser 1-31' });
  }
  const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : loan.activo;

  db.prepare('UPDATE loans SET nombre = ?, banco = ?, dia_pago = ?, activo = ? WHERE user_id = ? AND id = ?')
    .run(nombre, banco, diaPago, activo, req.user.id, loan.id);
  res.json(serializeLoan(findById.get(req.user.id, loan.id)));
});

router.delete('/:id', (req, res) => {
  const loan = findById.get(req.user.id, Number(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Préstamo no existe' });
  db.prepare('DELETE FROM loans WHERE user_id = ? AND id = ?').run(req.user.id, loan.id);
  res.json({ ok: true });
});

module.exports = router;
