const express = require('express');
const db = require('../db/database');
const { isValidMonthKey, currentMonthKey, clampDay, todayLocalISO, dateInMonth } = require('../lib/dates');
const { GASTO_CLAUSE, INGRESO_CLAUSE, MONTO_RD_EXPR, rowToTx } = require('../lib/tx');
const { getExchangeRate } = require('../lib/settings');
const { round2 } = require('../lib/amortization');

const router = express.Router();

// Quincena efectiva: la elegida por el usuario o la derivada del día
const QUINCENA_EXPR = 'COALESCE(quincena, CASE WHEN CAST(substr(fecha_sort, 9, 2) AS INTEGER) >= 16 THEN 2 ELSE 1 END)';

// Resumen del módulo de Ingresos: 4 KPIs + contribución por fuente +
// fuentes conocidas (para autocompletar). Todo computado en servidor.
router.get('/ingresos/resumen', (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  const userId = req.user.id;
  const rate = getExchangeRate(userId).rate;

  const totalMes = round2(db.prepare(`
    SELECT COALESCE(SUM(${MONTO_RD_EXPR}), 0) AS t
    FROM transactions WHERE user_id = ? AND ${INGRESO_CLAUSE} AND fecha_sort LIKE ? || '%'
  `).get(rate, userId, month).t);

  const gastosMes = round2(db.prepare(`
    SELECT COALESCE(SUM(${MONTO_RD_EXPR}), 0) AS t
    FROM transactions WHERE user_id = ? AND ${GASTO_CLAUSE} AND fecha_sort LIKE ? || '%'
  `).get(rate, userId, month).t);

  const registros = db.prepare(
    `SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND ${INGRESO_CLAUSE} AND fecha_sort LIKE ? || '%'`
  ).get(userId, month).n;

  // Último ingreso del mes (más reciente por fecha)
  const ultimoRow = db.prepare(`
    SELECT monto_num, moneda, fecha_sort FROM transactions
    WHERE user_id = ? AND ${INGRESO_CLAUSE} AND fecha_sort LIKE ? || '%'
    ORDER BY fecha_sort DESC, id DESC LIMIT 1
  `).get(userId, month);
  const ultimo = ultimoRow
    ? { montoNum: ultimoRow.monto_num, moneda: ultimoRow.moneda, fechaSort: ultimoRow.fecha_sort }
    : null;

  // Promedio de los últimos 3 meses COMPLETOS (excluye el mes en curso)
  const prevMonths = db.prepare(`
    SELECT substr(fecha_sort, 1, 7) AS mk, SUM(${MONTO_RD_EXPR}) AS total
    FROM transactions
    WHERE user_id = ? AND ${INGRESO_CLAUSE} AND fecha_sort < ? || '-01'
    GROUP BY mk ORDER BY mk DESC LIMIT 3
  `).all(rate, userId, month);
  const promedio3 = prevMonths.length
    ? round2(prevMonths.reduce((a, r) => a + r.total, 0) / prevMonths.length)
    : 0;

  // Tasa de ahorro del mes: (ingresos - gastos) / ingresos
  const tasaAhorro = totalMes > 0 ? round2(((totalMes - gastosMes) / totalMes) * 100) : 0;

  // Contribución por fuente (solo relevante con >1 fuente)
  const porFuente = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(fuente), ''), '(sin fuente)') AS fuente,
           SUM(${MONTO_RD_EXPR}) AS total
    FROM transactions WHERE user_id = ? AND ${INGRESO_CLAUSE} AND fecha_sort LIKE ? || '%'
    GROUP BY fuente ORDER BY total DESC
  `).all(rate, userId, month).map((r) => ({
    fuente: r.fuente,
    total: round2(r.total),
    pct: totalMes > 0 ? round2((r.total / totalMes) * 100) : 0
  }));

  // Fuentes conocidas (para el datalist de autocompletar)
  const fuentes = db.prepare(`
    SELECT DISTINCT TRIM(fuente) AS f FROM transactions
    WHERE user_id = ? AND ${INGRESO_CLAUSE} AND fuente IS NOT NULL AND TRIM(fuente) <> ''
    ORDER BY f
  `).all(userId).map((r) => r.f);

  res.json({
    month,
    totalMes,
    registros,
    ultimo,
    promedio3,
    tasaAhorro,
    deficit: totalMes > 0 && gastosMes > totalMes,
    porFuente,
    fuentes
  });
});

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

  // ── Resumen de todas las deudas: tarjetas + préstamos + fijos ──
  const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);
  let deudaTarjetasRD = 0;
  let limiteTarjetasRD = 0;
  let pagoMinTarjetas = 0;
  const itemsTarjetas = [];
  for (const c of cards) {
    const deuda = Math.max(0, c.used_rd) + Math.max(0, c.used_usd) * rate;
    deudaTarjetasRD += deuda;
    limiteTarjetasRD += c.limit_rd + c.limit_usd * rate;
    pagoMinTarjetas += deuda * c.pago_minimo_pct / 100;
    itemsTarjetas.push({ label: c.label, monto: round2(deuda) });
  }

  const loans = db.prepare('SELECT * FROM loans WHERE user_id = ? AND activo = 1 AND saldo_pendiente > 0').all(userId);
  const deudaPrestamos = loans.reduce((acc, l) => acc + l.saldo_pendiente, 0);
  const cuotasPrestamos = loans.reduce((acc, l) => acc + l.cuota_mensual, 0);
  const itemsPrestamos = loans.map((l) => ({ label: l.nombre, monto: round2(l.saldo_pendiente) }));

  // Gastos fijos del mes aún no pagados: compromisos vivos que cuentan
  // en la visual consolidada de deudas
  const hoyISO = todayLocalISO();
  const itemsFijos = [];
  let deudaFijos = 0;
  for (const g of db.prepare('SELECT * FROM fixed_expenses WHERE user_id = ? AND activo = 1').all(userId)) {
    let pagados = [];
    try {
      pagados = JSON.parse(g.pagados_meses || '[]');
    } catch {
      pagados = [];
    }
    if (pagados.includes(month)) continue;
    const fecha = dateInMonth(month, g.dia);
    deudaFijos += g.monto;
    itemsFijos.push({ label: g.concepto, monto: g.monto, estado: fecha < hoyISO ? 'vencido' : 'pendiente' });
  }

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
      gastosFijosPendientesRD: round2(deudaFijos),
      totalConsolidadoRD: round2(deudaTarjetasRD + deudaPrestamos + deudaFijos),
      usoGlobalPct: limiteTarjetasRD > 0 ? round2((deudaTarjetasRD / limiteTarjetasRD) * 100) : 0,
      pagoMinimoTotal: round2(pagoMinTarjetas + cuotasPrestamos),
      tarjetas: cards.length,
      prestamos: loans.length,
      porCategoria: [
        { key: 'tarjetas', label: 'Tarjetas de crédito', total: round2(deudaTarjetasRD), items: itemsTarjetas },
        { key: 'gastosFijos', label: 'Gastos fijos del mes', total: round2(deudaFijos), items: itemsFijos },
        { key: 'prestamos', label: 'Préstamos', total: round2(deudaPrestamos), items: itemsPrestamos }
      ]
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
