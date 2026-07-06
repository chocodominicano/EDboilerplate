const express = require('express');
const db = require('../db/database');
const { isValidMonthKey, currentMonthKey } = require('../lib/dates');
const { GASTO_CLAUSE, MONTO_RD_EXPR } = require('../lib/tx');
const { getExchangeRate } = require('../lib/settings');
const { round2 } = require('../lib/amortization');

const router = express.Router();

router.get('/', (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  const rate = getExchangeRate(req.user.id).rate;

  const spentStmt = db.prepare(`
    SELECT COALESCE(SUM(${MONTO_RD_EXPR}), 0) AS gastado
    FROM transactions
    WHERE user_id = ? AND cat = ? AND ${GASTO_CLAUSE} AND fecha_sort LIKE ? || '%'
  `);

  const rows = db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY cat').all(req.user.id);
  res.json(rows.map((b) => {
    const gastado = round2(spentStmt.get(rate, req.user.id, b.cat, month).gastado);
    return {
      id: b.id,
      cat: b.cat,
      monto: b.monto,
      month,
      gastado,
      pct: b.monto > 0 ? round2((gastado / b.monto) * 100) : (gastado > 0 ? 100 : 0)
    };
  }));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const cat = String(b.cat || '').trim();
  if (!cat) return res.status(400).json({ error: 'La categoría es requerida' });
  const monto = Number(b.monto);
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'monto debe ser mayor que 0' });

  db.prepare(`
    INSERT INTO budgets (user_id, cat, monto) VALUES (?, ?, ?)
    ON CONFLICT(user_id, cat) DO UPDATE SET monto = excluded.monto
  `).run(req.user.id, cat, monto);
  res.status(201).json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM budgets WHERE user_id = ? AND id = ?').run(req.user.id, Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Presupuesto no existe' });
  res.json({ ok: true });
});

module.exports = router;
