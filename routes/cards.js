const express = require('express');
const db = require('../db/database');
const { isValidFechaSort, todayLocalISO, nextOccurrence, quincenaOf, currentMonthKey, isValidMonthKey, addMonthsToKey } = require('../lib/dates');
const { cycleRange } = require('../lib/cycle');
const { round2 } = require('../lib/amortization');
const { getExchangeRate } = require('../lib/settings');
const { GASTO_CLAUSE, MONTO_RD_EXPR } = require('../lib/tx');

const router = express.Router();

const findById = db.prepare('SELECT * FROM credit_cards WHERE user_id = ? AND id = ?');
const findByKey = db.prepare('SELECT * FROM credit_cards WHERE user_id = ? AND key = ?');
const listStmt = db.prepare('SELECT * FROM credit_cards WHERE user_id = ? ORDER BY label');

function pct(used, limit) {
  if (used <= 0) return 0; // sobrepago = saldo a favor, no uso negativo
  if (limit <= 0) return 100;
  return round2((used / limit) * 100);
}

function serializeCard(row, rate) {
  const hoy = todayLocalISO();
  const cycle = cycleRange(row.dia_corte, hoy);
  const pagoMinimoRD = round2(Math.max(0, row.used_rd) * row.pago_minimo_pct / 100);
  const pagoMinimoUSD = round2(Math.max(0, row.used_usd) * row.pago_minimo_pct / 100);
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    bank: row.bank,
    red: row.red,
    producto: row.producto,
    limitRD: row.limit_rd,
    usedRD: row.used_rd,
    limitUSD: row.limit_usd,
    usedUSD: row.used_usd,
    dobleSaldo: !!row.doble_saldo,
    tasaInteres: row.tasa_interes,
    alertaRD: row.alerta_rd,
    diaCorte: row.dia_corte,
    diaPago: row.dia_pago,
    pagoMinimoPct: row.pago_minimo_pct,
    activo: !!row.activo,
    usoPctRD: pct(row.used_rd, row.limit_rd),
    usoPctUSD: pct(row.used_usd, row.limit_usd),
    pagoMinimoRD,
    pagoMinimoUSD,
    pagoMinimoTotalRD: round2(pagoMinimoRD + pagoMinimoUSD * rate),
    deudaTotalRD: round2(Math.max(0, row.used_rd) + Math.max(0, row.used_usd) * rate),
    proximoCorte: cycle.end,
    proximoPago: nextOccurrence(row.dia_pago, hoy),
    cicloActual: cycle
  };
}

function slugify(label) {
  return String(label).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tarjeta';
}

// Valida el payload de alta/edición. Devuelve {error} o {data}.
function parseCardPayload(b) {
  b = b || {};
  const label = String(b.label || '').trim();
  if (!label) return { error: 'El nombre (label) de la tarjeta es requerido' };

  const diaCorte = Number(b.diaCorte);
  const diaPago = Number(b.diaPago);
  if (!Number.isInteger(diaCorte) || diaCorte < 1 || diaCorte > 31) return { error: 'diaCorte debe ser 1-31' };
  if (!Number.isInteger(diaPago) || diaPago < 1 || diaPago > 31) return { error: 'diaPago debe ser 1-31' };

  const num = (v, def) => {
    if (v === undefined || v === null || v === '') return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };

  return {
    data: {
      label,
      bank: b.bank ? String(b.bank) : null,
      red: b.red ? String(b.red) : null,
      producto: b.producto ? String(b.producto) : null,
      limit_rd: Math.max(0, num(b.limitRD, 0)),
      used_rd: num(b.usedRD, 0),
      limit_usd: Math.max(0, num(b.limitUSD, 0)),
      used_usd: num(b.usedUSD, 0),
      doble_saldo: b.dobleSaldo ? 1 : 0,
      tasa_interes: num(b.tasaInteres, 60),
      alerta_rd: b.alertaRD !== undefined && b.alertaRD !== null && b.alertaRD !== '' ? num(b.alertaRD, null) : null,
      dia_corte: diaCorte,
      dia_pago: diaPago,
      pago_minimo_pct: num(b.pagoMinimoPct, 5)
    }
  };
}

router.get('/', (req, res) => {
  const rate = getExchangeRate(req.user.id).rate;
  res.json(listStmt.all(req.user.id).map((row) => serializeCard(row, rate)));
});

// Tendencia de gasto por tarjeta: mes actual vs mes anterior (para el tab Salud)
router.get('/tendencia', (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  const prevMonth = addMonthsToKey(month, -1);
  const rate = getExchangeRate(req.user.id).rate;

  const sumFor = (m) => db.prepare(`
    SELECT cc_key, COALESCE(SUM(${MONTO_RD_EXPR}), 0) AS total
    FROM transactions
    WHERE user_id = ? AND ${GASTO_CLAUSE} AND cc_key IS NOT NULL AND fecha_sort LIKE ? || '%'
    GROUP BY cc_key
  `).all(rate, req.user.id, m);

  const actual = Object.fromEntries(sumFor(month).map((r) => [r.cc_key, round2(r.total)]));
  const anterior = Object.fromEntries(sumFor(prevMonth).map((r) => [r.cc_key, round2(r.total)]));

  const cards = listStmt.all(req.user.id);
  res.json(cards.map((c) => ({
    key: c.key,
    label: c.label,
    mesActual: actual[c.key] || 0,
    mesAnterior: anterior[c.key] || 0
  })));
});

router.post('/', (req, res) => {
  const parsed = parseCardPayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let key = req.body.key ? slugify(req.body.key) : slugify(parsed.data.label);
  let candidate = key;
  let n = 2;
  while (findByKey.get(req.user.id, candidate)) candidate = `${key}-${n++}`;
  key = candidate;

  const info = db.prepare(`
    INSERT INTO credit_cards (
      user_id, key, label, bank, red, producto, limit_rd, used_rd, limit_usd, used_usd,
      doble_saldo, tasa_interes, alerta_rd, dia_corte, dia_pago, pago_minimo_pct
    ) VALUES (
      @user_id, @key, @label, @bank, @red, @producto, @limit_rd, @used_rd, @limit_usd, @used_usd,
      @doble_saldo, @tasa_interes, @alerta_rd, @dia_corte, @dia_pago, @pago_minimo_pct
    )
  `).run({ user_id: req.user.id, key, ...parsed.data });

  const rate = getExchangeRate(req.user.id).rate;
  res.status(201).json(serializeCard(findById.get(req.user.id, info.lastInsertRowid), rate));
});

router.put('/:id', (req, res) => {
  const card = findById.get(req.user.id, Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'Tarjeta no existe' });

  const parsed = parseCardPayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  db.prepare(`
    UPDATE credit_cards SET
      label=@label, bank=@bank, red=@red, producto=@producto,
      limit_rd=@limit_rd, used_rd=@used_rd, limit_usd=@limit_usd, used_usd=@used_usd,
      doble_saldo=@doble_saldo, tasa_interes=@tasa_interes, alerta_rd=@alerta_rd,
      dia_corte=@dia_corte, dia_pago=@dia_pago, pago_minimo_pct=@pago_minimo_pct
    WHERE user_id=@user_id AND id=@id
  `).run({ ...parsed.data, user_id: req.user.id, id: card.id });

  const rate = getExchangeRate(req.user.id).rate;
  res.json(serializeCard(findById.get(req.user.id, card.id), rate));
});

router.delete('/:id', (req, res) => {
  const card = findById.get(req.user.id, Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'Tarjeta no existe' });
  const remove = db.transaction(() => {
    // Borrar la tarjeta borra sus compras a cuotas en cascada (FK): antes
    // de eso, los pagos de esas cuotas se desvinculan para que queden como
    // gastos históricos normales y no huérfanos bloqueados.
    db.prepare(`
      UPDATE transactions SET installment_id = NULL
      WHERE user_id = ? AND installment_id IN (SELECT id FROM card_installments WHERE card_id = ?)
    `).run(req.user.id, card.id);
    // Las transacciones históricas se conservan (cc_key queda huérfano)
    db.prepare('DELETE FROM credit_cards WHERE user_id = ? AND id = ?').run(req.user.id, card.id);
  });
  remove();
  res.json({ ok: true });
});

// Pago de tarjeta = TRANSFERENCIA (neg=0, is_pago_tarjeta=1): baja el saldo
// usado y nunca cuenta como gasto (principio clave del documento).
router.post('/:id/pay', (req, res) => {
  const card = findById.get(req.user.id, Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'Tarjeta no existe' });

  const b = req.body || {};
  const monto = Number(b.monto);
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'monto debe ser mayor que 0' });
  const moneda = b.moneda === 'USD$' ? 'USD$' : 'RD$';
  const fechaSort = b.fechaSort || todayLocalISO();
  if (!isValidFechaSort(fechaSort)) return res.status(400).json({ error: 'fechaSort inválido (yyyy-mm-dd)' });

  const pay = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO transactions (
        user_id, nombre, cat, metodo, monto_num, moneda, neg,
        is_pago_tarjeta, fecha_sort, quincena, cuenta, cc_key, cc_is_usd
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, `Pago ${card.label}`, 'Pago de tarjeta',
      b.cuenta ? String(b.cuenta) : 'Cuenta', monto, moneda,
      fechaSort, quincenaOf(fechaSort),
      b.cuenta ? String(b.cuenta) : null, card.key, moneda === 'USD$' ? 1 : 0
    );
    if (moneda === 'USD$') {
      db.prepare('UPDATE credit_cards SET used_usd = used_usd - ? WHERE id = ?').run(monto, card.id);
    } else {
      db.prepare('UPDATE credit_cards SET used_rd = used_rd - ? WHERE id = ?').run(monto, card.id);
    }
    return info.lastInsertRowid;
  });

  const txId = pay();
  const rate = getExchangeRate(req.user.id).rate;
  res.status(201).json({
    ok: true,
    txId,
    card: serializeCard(findById.get(req.user.id, card.id), rate)
  });
});

module.exports = router;
