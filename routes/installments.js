const express = require('express');
const db = require('../db/database');
const { isValidFechaSort, todayLocalISO, quincenaOf, addMonthsToKey, dateInMonth, monthKey } = require('../lib/dates');
const { frenchPayment, splitCuota, round2 } = require('../lib/amortization');

const router = express.Router();

const findCard = db.prepare('SELECT * FROM credit_cards WHERE user_id = ? AND id = ?');
const findById = db.prepare('SELECT * FROM card_installments WHERE user_id = ? AND id = ?');
const listStmt = db.prepare(`
  SELECT ci.*, cc.label AS card_label, cc.dia_pago AS card_dia_pago
  FROM card_installments ci JOIN credit_cards cc ON cc.id = ci.card_id
  WHERE ci.user_id = ? ORDER BY ci.created_at DESC
`);
const oneStmt = db.prepare(`
  SELECT ci.*, cc.label AS card_label, cc.dia_pago AS card_dia_pago
  FROM card_installments ci JOIN credit_cards cc ON cc.id = ci.card_id
  WHERE ci.user_id = ? AND ci.id = ?
`);

function serialize(row) {
  const terminada = row.saldo_pendiente <= 0;
  const nextKey = addMonthsToKey(monthKey(row.fecha_inicio), row.cuotas_pagadas + 1);
  return {
    id: row.id,
    cardId: row.card_id,
    cardLabel: row.card_label,
    descripcion: row.descripcion,
    icono: row.icono || '💳',
    montoOriginal: row.monto_original,
    numCuotas: row.num_cuotas,
    tasaAnual: row.tasa_anual,
    cuotaMensual: row.cuota_mensual,
    fechaInicio: row.fecha_inicio,
    saldoPendiente: row.saldo_pendiente,
    cuotasPagadas: row.cuotas_pagadas,
    terminada,
    progresoPct: round2((row.cuotas_pagadas / row.num_cuotas) * 100),
    proximaCuotaFecha: terminada ? null : dateInMonth(nextKey, row.card_dia_pago)
  };
}

router.get('/', (req, res) => {
  res.json(listStmt.all(req.user.id).map(serialize));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const card = findCard.get(req.user.id, Number(b.cardId));
  if (!card) return res.status(400).json({ error: 'La tarjeta no existe' });

  const descripcion = String(b.descripcion || '').trim();
  if (!descripcion) return res.status(400).json({ error: 'La descripción es requerida' });

  const montoOriginal = Number(b.montoOriginal);
  const numCuotas = Number(b.numCuotas);
  const tasaAnual = b.tasaAnual !== undefined && b.tasaAnual !== '' ? Number(b.tasaAnual) : 0;
  if (!Number.isFinite(montoOriginal) || montoOriginal <= 0) return res.status(400).json({ error: 'montoOriginal debe ser mayor que 0' });
  if (!Number.isInteger(numCuotas) || numCuotas <= 0) return res.status(400).json({ error: 'numCuotas debe ser entero positivo' });
  if (!Number.isFinite(tasaAnual) || tasaAnual < 0) return res.status(400).json({ error: 'tasaAnual inválida' });

  const fechaInicio = b.fechaInicio || todayLocalISO();
  if (!isValidFechaSort(fechaInicio)) return res.status(400).json({ error: 'fechaInicio inválida (yyyy-mm-dd)' });

  const cuota = round2(frenchPayment(montoOriginal, tasaAnual, numCuotas));
  const info = db.prepare(`
    INSERT INTO card_installments
      (user_id, card_id, descripcion, icono, monto_original, num_cuotas, tasa_anual, cuota_mensual, fecha_inicio, saldo_pendiente)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, card.id, descripcion, b.icono ? String(b.icono) : null,
    montoOriginal, numCuotas, tasaAnual, cuota, fechaInicio, montoOriginal);

  res.status(201).json(serialize(oneStmt.get(req.user.id, info.lastInsertRowid)));
});

// Vista previa de la tabla de amortización completa (no persiste nada)
router.get('/:id/schedule', (req, res) => {
  const row = oneStmt.get(req.user.id, Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Cuota no existe' });

  const schedule = [];
  let saldo = row.monto_original;
  let key = monthKey(row.fecha_inicio);
  for (let n = 1; n <= row.num_cuotas; n++) {
    const { interes, capital } = splitCuota(saldo, row.tasa_anual, row.cuota_mensual);
    saldo = round2(Math.max(0, saldo - capital));
    key = addMonthsToKey(key, 1);
    schedule.push({
      n,
      fecha: dateInMonth(key, row.card_dia_pago),
      cuota: round2(interes + capital),
      interes,
      capital,
      saldo,
      pagada: n <= row.cuotas_pagadas
    });
  }
  res.json({ schedule });
});

// Pago de cuota: separa interés/capital sobre el saldo actual (igual que
// préstamos). NO toca used_rd de la tarjeta — la línea de cuotas es
// independiente del saldo revolvente que sí sincroniza cc_key.
router.post('/:id/pay', (req, res) => {
  const row = oneStmt.get(req.user.id, Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Cuota no existe' });
  if (row.saldo_pendiente <= 0) return res.status(400).json({ error: 'Esta cuota ya está saldada' });

  const fechaSort = (req.body && req.body.fechaSort) || todayLocalISO();
  if (!isValidFechaSort(fechaSort)) return res.status(400).json({ error: 'fechaSort inválido (yyyy-mm-dd)' });

  const { interes, capital } = splitCuota(row.saldo_pendiente, row.tasa_anual, row.cuota_mensual);
  const montoPagado = round2(interes + capital);

  const pay = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (user_id, nombre, cat, metodo, monto_num, moneda, neg,
                                fecha_sort, quincena, installment_id)
      VALUES (?, ?, 'Cuotas', ?, ?, 'RD$', 1, ?, ?, ?)
    `).run(req.user.id, `Cuota ${row.descripcion}`, row.card_label,
      montoPagado, fechaSort, quincenaOf(fechaSort), row.id);

    const nuevoSaldo = round2(Math.max(0, row.saldo_pendiente - capital));
    db.prepare('UPDATE card_installments SET saldo_pendiente = ?, cuotas_pagadas = cuotas_pagadas + 1 WHERE id = ?')
      .run(nuevoSaldo, row.id);
  });
  pay();

  res.status(201).json({
    ok: true,
    pago: { interes, capital, total: montoPagado },
    installment: serialize(oneStmt.get(req.user.id, row.id))
  });
});

router.delete('/:id', (req, res) => {
  const row = findById.get(req.user.id, Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Cuota no existe' });
  const remove = db.transaction(() => {
    // Sus pagos se conservan como gastos históricos normales (editables);
    // sin esto quedarían bloqueados para siempre por el guard de installment_id
    db.prepare('UPDATE transactions SET installment_id = NULL WHERE user_id = ? AND installment_id = ?')
      .run(req.user.id, row.id);
    db.prepare('DELETE FROM card_installments WHERE user_id = ? AND id = ?').run(req.user.id, row.id);
  });
  remove();
  res.json({ ok: true });
});

module.exports = router;
