const express = require('express');
const db = require('../db/database');
const { isValidFechaSort, isValidMonthKey, quincenaOf, todayLocalISO } = require('../lib/dates');
const { cycleRange } = require('../lib/cycle');
const { GASTO_CLAUSE, INGRESO_CLAUSE, rowToTx, applyCardEffect } = require('../lib/tx');

const router = express.Router();

const findCard = db.prepare('SELECT * FROM credit_cards WHERE user_id = ? AND key = ?');
const findTx = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND id = ?');

const insertTx = db.prepare(`
  INSERT INTO transactions (
    user_id, nombre, cat, metodo, monto_num, moneda, neg,
    is_pago_tarjeta, is_pago_prestamo, fecha_sort, quincena,
    fuente, cuenta, tags, icon, icon_bg, cc_key, cc_is_usd,
    loan_id, fixed_expense_id, fixed_income_id
  ) VALUES (
    @user_id, @nombre, @cat, @metodo, @monto_num, @moneda, @neg,
    @is_pago_tarjeta, @is_pago_prestamo, @fecha_sort, @quincena,
    @fuente, @cuenta, @tags, @icon, @icon_bg, @cc_key, @cc_is_usd,
    @loan_id, @fixed_expense_id, @fixed_income_id
  )
`);

// Valida y normaliza el payload común de una transacción. Devuelve
// {error} o {data} listo para insertTx (sin user_id).
function parseTxPayload(body, userId) {
  const b = body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return { error: 'El nombre es requerido' };

  const montoNum = Number(b.montoNum);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    return { error: 'montoNum debe ser un número mayor que 0' };
  }

  if (!isValidFechaSort(b.fechaSort)) {
    return { error: 'fechaSort es requerido en formato yyyy-mm-dd' };
  }

  const moneda = b.moneda === 'USD$' ? 'USD$' : 'RD$';
  const neg = b.neg === false || b.neg === 0 || b.neg === '0' ? 0 : 1;

  let quincena = Number(b.quincena);
  if (quincena !== 1 && quincena !== 2) quincena = quincenaOf(b.fechaSort);

  let tags = [];
  if (Array.isArray(b.tags)) tags = b.tags.map(String).slice(0, 20);

  const ccKey = b.ccKey ? String(b.ccKey) : null;
  if (ccKey) {
    const card = findCard.get(userId, ccKey);
    if (!card) return { error: `La tarjeta '${ccKey}' no existe` };
  }

  return {
    data: {
      nombre,
      cat: b.cat ? String(b.cat) : null,
      metodo: b.metodo ? String(b.metodo) : null,
      monto_num: montoNum,
      moneda,
      neg,
      is_pago_tarjeta: 0,
      is_pago_prestamo: 0,
      fecha_sort: b.fechaSort,
      quincena,
      fuente: b.fuente ? String(b.fuente) : null,
      cuenta: b.cuenta ? String(b.cuenta) : null,
      tags: JSON.stringify(tags),
      icon: b.icon ? String(b.icon) : null,
      icon_bg: b.iconBg ? String(b.iconBg) : null,
      cc_key: ccKey,
      cc_is_usd: moneda === 'USD$' ? 1 : 0,
      loan_id: null,
      fixed_expense_id: null,
      fixed_income_id: null
    }
  };
}

router.post('/', (req, res) => {
  const parsed = parseTxPayload(req.body, req.user.id);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const create = db.transaction(() => {
    const info = insertTx.run({ user_id: req.user.id, ...parsed.data });
    const row = findTx.get(req.user.id, info.lastInsertRowid);
    applyCardEffect(req.user.id, row, +1);
    return row;
  });

  res.status(201).json(rowToTx(create()));
});

router.get('/', (req, res) => {
  const where = ['user_id = ?'];
  const params = [req.user.id];
  const q = req.query;

  if (q.month) {
    if (!isValidMonthKey(q.month)) return res.status(400).json({ error: 'month inválido (yyyy-mm)' });
    where.push("fecha_sort LIKE ? || '%'");
    params.push(q.month);
  }
  if (q.quincena === '1' || q.quincena === '2') {
    where.push('COALESCE(quincena, CASE WHEN CAST(substr(fecha_sort, 9, 2) AS INTEGER) >= 16 THEN 2 ELSE 1 END) = ?');
    params.push(Number(q.quincena));
  }
  if (q.kind === 'gasto') where.push(GASTO_CLAUSE);
  else if (q.kind === 'ingreso') where.push(INGRESO_CLAUSE);
  else if (q.neg === '0' || q.neg === '1') {
    where.push('neg = ?');
    params.push(Number(q.neg));
  }
  if (q.cat) {
    where.push('cat = ?');
    params.push(String(q.cat));
  }
  if (q.ccKey) {
    where.push('cc_key = ?');
    params.push(String(q.ccKey));
    if (q.cycle === 'current') {
      const card = findCard.get(req.user.id, String(q.ccKey));
      if (!card) return res.status(400).json({ error: 'Tarjeta no existe' });
      const range = cycleRange(card.dia_corte, todayLocalISO());
      where.push('fecha_sort BETWEEN ? AND ?');
      params.push(range.start, range.end);
      res.set('X-Cycle-Start', range.start);
      res.set('X-Cycle-End', range.end);
    }
  }

  let limit = Number(q.limit);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) limit = 500;

  const rows = db.prepare(`
    SELECT * FROM transactions
    WHERE ${where.join(' AND ')}
    ORDER BY fecha_sort DESC, id DESC
    LIMIT ?
  `).all(...params, limit);

  res.json(rows.map(rowToTx));
});

router.put('/:id', (req, res) => {
  const old = findTx.get(req.user.id, Number(req.params.id));
  if (!old) return res.status(404).json({ error: 'Transacción no existe' });
  if (old.loan_id) {
    return res.status(400).json({ error: 'Los pagos de préstamo se gestionan desde el módulo de préstamos' });
  }
  if (old.installment_id) {
    return res.status(400).json({ error: 'Los pagos de cuota se gestionan desde el módulo de tarjetas' });
  }
  if (old.is_pago_tarjeta) {
    return res.status(400).json({ error: 'Los pagos de tarjeta se gestionan desde el módulo de tarjetas' });
  }
  if (old.goal_id) {
    return res.status(400).json({ error: 'Los abonos a metas se gestionan desde el módulo de metas' });
  }

  const parsed = parseTxPayload(req.body, req.user.id);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const update = db.transaction(() => {
    applyCardEffect(req.user.id, old, -1);
    db.prepare(`
      UPDATE transactions SET
        nombre=@nombre, cat=@cat, metodo=@metodo, monto_num=@monto_num,
        moneda=@moneda, neg=@neg, fecha_sort=@fecha_sort, quincena=@quincena,
        fuente=@fuente, cuenta=@cuenta, tags=@tags, icon=@icon, icon_bg=@icon_bg,
        cc_key=@cc_key, cc_is_usd=@cc_is_usd
      WHERE user_id=@user_id AND id=@id
    `).run({ ...parsed.data, user_id: req.user.id, id: old.id });
    const row = findTx.get(req.user.id, old.id);
    applyCardEffect(req.user.id, row, +1);
    return row;
  });

  res.json(rowToTx(update()));
});

router.delete('/:id', (req, res) => {
  const old = findTx.get(req.user.id, Number(req.params.id));
  if (!old) return res.status(404).json({ error: 'Transacción no existe' });
  if (old.loan_id) {
    return res.status(400).json({ error: 'Los pagos de préstamo se gestionan desde el módulo de préstamos' });
  }
  if (old.installment_id) {
    return res.status(400).json({ error: 'Los pagos de cuota se gestionan desde el módulo de tarjetas' });
  }
  if (old.goal_id) {
    return res.status(400).json({ error: 'Los abonos a metas se gestionan desde el módulo de metas' });
  }

  const remove = db.transaction(() => {
    applyCardEffect(req.user.id, old, -1);
    // Mantener consistente el estado de fijos: al borrar la transacción
    // vinculada, el mes vuelve a quedar pendiente/no recibido.
    if (old.fixed_expense_id) unmarkMonth('fixed_expenses', 'pagados_meses', old.fixed_expense_id, req.user.id, old.fecha_sort.slice(0, 7));
    if (old.fixed_income_id) unmarkMonth('fixed_incomes', 'recibidos_meses', old.fixed_income_id, req.user.id, old.fecha_sort.slice(0, 7));
    db.prepare('DELETE FROM transactions WHERE user_id = ? AND id = ?').run(req.user.id, old.id);
  });

  remove();
  res.json({ ok: true });
});

function unmarkMonth(table, column, id, userId, month) {
  const row = db.prepare(`SELECT ${column} AS meses FROM ${table} WHERE user_id = ? AND id = ?`).get(userId, id);
  if (!row) return;
  let meses = [];
  try {
    meses = JSON.parse(row.meses || '[]');
  } catch {
    meses = [];
  }
  const next = meses.filter((m) => m !== month);
  if (next.length !== meses.length) {
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE user_id = ? AND id = ?`).run(JSON.stringify(next), userId, id);
  }
}

module.exports = router;
