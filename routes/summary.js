const express = require('express');
const db = require('../db/database');
const { isValidMonthKey, currentMonthKey, clampDay, todayLocalISO, dateInMonth } = require('../lib/dates');
const { GASTO_CLAUSE, INGRESO_CLAUSE, MONTO_RD_EXPR, rowToTx } = require('../lib/tx');
const { getExchangeRate } = require('../lib/settings');
const { round2 } = require('../lib/amortization');

const router = express.Router();

// Quincena efectiva: la elegida por el usuario o la derivada del día
const QUINCENA_EXPR = 'COALESCE(quincena, CASE WHEN CAST(substr(fecha_sort, 9, 2) AS INTEGER) >= 16 THEN 2 ELSE 1 END)';

router.get('/dashboard', (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  const userId = req.user.id;
  const exchangeRate = getExchangeRate(userId);
  const rate = exchangeRate.rate;

  const sum = (clause, extra = '') => db.prepare(`
    SELECT COALESCE(SUM(${MONTO_RD_EXPR}), 0) AS total
    FROM transactions
    WHERE user_id = ? AND ${clause} AND fecha_sort LIKE ? || '%' ${extra}
  `);

  const ingresos = round2(sum(INGRESO_CLAUSE).get(rate, userId, month).total);
  const gastos = round2(sum(GASTO_CLAUSE).get(rate, userId, month).total);
  const txCount = db.prepare(
    "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND fecha_sort LIKE ? || '%'"
  ).get(userId, month).n;

  const quincenas = {};
  for (const q of [1, 2]) {
    quincenas[`q${q}`] = {
      ingresos: round2(sum(INGRESO_CLAUSE, `AND ${QUINCENA_EXPR} = ${q}`).get(rate, userId, month).total),
      gastos: round2(sum(GASTO_CLAUSE, `AND ${QUINCENA_EXPR} = ${q}`).get(rate, userId, month).total)
    };
  }

  const ultimas5 = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ?
    ORDER BY fecha_sort DESC, id DESC LIMIT 5
  `).all(userId).map(rowToTx);

  // ── Resumen de todas las deudas: tarjetas + préstamos ──
  const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);
  let deudaTarjetasRD = 0;
  let limiteTarjetasRD = 0;
  let pagoMinTarjetas = 0;
  for (const c of cards) {
    deudaTarjetasRD += Math.max(0, c.used_rd) + Math.max(0, c.used_usd) * rate;
    limiteTarjetasRD += c.limit_rd + c.limit_usd * rate;
    pagoMinTarjetas += (Math.max(0, c.used_rd) + Math.max(0, c.used_usd) * rate) * c.pago_minimo_pct / 100;
  }

  const loans = db.prepare('SELECT * FROM loans WHERE user_id = ? AND activo = 1 AND saldo_pendiente > 0').all(userId);
  const deudaPrestamos = loans.reduce((acc, l) => acc + l.saldo_pendiente, 0);
  const cuotasPrestamos = loans.reduce((acc, l) => acc + l.cuota_mensual, 0);

  res.json({
    month,
    kpis: {
      balance: round2(ingresos - gastos),
      ingresos,
      gastos,
      txCount
    },
    quincenas,
    ultimas5,
    deudas: {
      totalDeudaRD: round2(deudaTarjetasRD + deudaPrestamos),
      deudaTarjetasRD: round2(deudaTarjetasRD),
      deudaPrestamosRD: round2(deudaPrestamos),
      usoGlobalPct: limiteTarjetasRD > 0 ? round2((deudaTarjetasRD / limiteTarjetasRD) * 100) : 0,
      pagoMinimoTotal: round2(pagoMinTarjetas + cuotasPrestamos),
      tarjetas: cards.length,
      prestamos: loans.length
    },
    exchangeRate
  });
});

// Radar: eventos del calendario del mes (gastos fijos, ingresos fijos,
// días de pago de tarjetas y cuotas de préstamos)
router.get('/radar', (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  const userId = req.user.id;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const hoy = todayLocalISO();
  const events = [];

  const parse = (raw) => {
    try {
      const v = JSON.parse(raw || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };

  for (const g of db.prepare('SELECT * FROM fixed_expenses WHERE user_id = ? AND activo = 1').all(userId)) {
    const pagado = parse(g.pagados_meses).includes(month);
    const fecha = dateInMonth(month, g.dia);
    events.push({
      dia: clampDay(g.dia, y, m),
      tipo: 'gasto_fijo',
      refId: g.id,
      label: g.concepto,
      monto: g.monto,
      estado: pagado ? 'pagado' : (fecha < hoy ? 'vencido' : 'pendiente')
    });
  }

  for (const i of db.prepare('SELECT * FROM fixed_incomes WHERE user_id = ? AND activo = 1').all(userId)) {
    events.push({
      dia: clampDay(i.dia, y, m),
      tipo: 'ingreso_fijo',
      refId: i.id,
      label: i.descripcion,
      monto: i.monto,
      estado: parse(i.recibidos_meses).includes(month) ? 'recibido' : 'pendiente'
    });
  }

  const rate = getExchangeRate(userId).rate;
  for (const c of db.prepare('SELECT * FROM credit_cards WHERE user_id = ? AND activo = 1').all(userId)) {
    const pagoMin = (Math.max(0, c.used_rd) + Math.max(0, c.used_usd) * rate) * c.pago_minimo_pct / 100;
    events.push({
      dia: clampDay(c.dia_pago, y, m),
      tipo: 'pago_tarjeta',
      refId: c.id,
      label: `Pago ${c.label}`,
      monto: round2(pagoMin),
      estado: 'programado'
    });
  }

  for (const l of db.prepare('SELECT * FROM loans WHERE user_id = ? AND activo = 1 AND saldo_pendiente > 0').all(userId)) {
    events.push({
      dia: clampDay(l.dia_pago, y, m),
      tipo: 'cuota_prestamo',
      refId: l.id,
      label: `Cuota ${l.nombre}`,
      monto: l.cuota_mensual,
      estado: 'programado'
    });
  }

  events.sort((a, b) => a.dia - b.dia);
  res.json({ month, diasEnMes: clampDay(31, y, m), events });
});

module.exports = router;
