const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const db = require('../db/database');
const {
  isValidMonthKey, currentMonthKey, todayLocalISO, monthKey,
  addMonthsToKey, daysInMonth, daysBetween
} = require('../lib/dates');
const { GASTO_CLAUSE, INGRESO_CLAUSE, MONTO_RD_EXPR, rowToTx } = require('../lib/tx');
const { getExchangeRate } = require('../lib/settings');
const { round2, splitCuota } = require('../lib/amortization');

const router = express.Router();

// ─── Tab Mensual ────────────────────────────────────────────────────

// Reconstruye la evolución REAL del saldo de un préstamo replayando sus
// pagos en orden cronológico (misma matemática que /pay y /pay-extra usan
// al escribir cada transacción) — a diferencia de una aproximación, esto
// usa los pagos reales guardados en transactions.
function loanBalanceTimeline(loan, pagos) {
  let saldo = loan.original;
  const puntos = [{ fecha: loan.fecha_inicio, saldo }];
  for (const p of pagos) {
    if (p.nombre.startsWith('Abono extra')) {
      const capital = round2(p.monto_num / (1 + loan.penalidad_pct / 100));
      saldo = round2(Math.max(0, saldo - capital));
    } else {
      const { capital } = splitCuota(saldo, loan.tasa_anual, loan.cuota_mensual);
      saldo = round2(Math.max(0, saldo - capital));
    }
    puntos.push({ fecha: p.fecha_sort, saldo });
  }
  return puntos;
}

// Saldo total (todos los préstamos activos con historial) al cierre de
// cada uno de los últimos `meses` meses, para la tendencia de la sección
// Préstamos del tab Mensual.
function prestamosEvolucion(userId, meses) {
  const loans = db.prepare('SELECT * FROM loans WHERE user_id = ? AND activo = 1').all(userId);
  const pagosStmt = db.prepare(
    'SELECT nombre, monto_num, fecha_sort FROM transactions WHERE user_id = ? AND loan_id = ? ORDER BY fecha_sort ASC, id ASC'
  );
  const timelines = loans.map((l) => loanBalanceTimeline(l, pagosStmt.all(userId, l.id)));

  const keys = [];
  let k = addMonthsToKey(currentMonthKey(), -(meses - 1));
  for (let i = 0; i < meses; i++) { keys.push(k); k = addMonthsToKey(k, 1); }

  return keys.map((mesKey) => {
    const corte = `${mesKey}-31`; // string-compare funciona: 'yyyy-mm-31' >= cualquier fecha real del mes
    const saldoTotal = timelines.reduce((acc, puntos) => {
      let vigente = null;
      for (const p of puntos) {
        if (p.fecha <= corte) vigente = p.saldo; else break;
      }
      return acc + (vigente ?? 0);
    }, 0);
    return { mesKey, saldoTotal: round2(saldoTotal) };
  });
}

function buildMensual(userId, month) {
  const rate = getExchangeRate(userId).rate;
  const prevMonth = addMonthsToKey(month, -1);

  const sumRD = (clause, m) => db.prepare(`
    SELECT COALESCE(SUM(${MONTO_RD_EXPR}), 0) AS t
    FROM transactions WHERE user_id = ? AND ${clause} AND fecha_sort LIKE ? || '%'
  `).get(rate, userId, m).t;

  const ingresos = round2(sumRD(INGRESO_CLAUSE, month));
  const gastosRD = round2(db.prepare(`
    SELECT COALESCE(SUM(monto_num), 0) AS t FROM transactions
    WHERE user_id = ? AND ${GASTO_CLAUSE} AND moneda = 'RD$' AND fecha_sort LIKE ? || '%'
  `).get(userId, month).t);
  const gastosUSD = round2(db.prepare(`
    SELECT COALESCE(SUM(monto_num), 0) AS t FROM transactions
    WHERE user_id = ? AND ${GASTO_CLAUSE} AND moneda = 'USD$' AND fecha_sort LIKE ? || '%'
  `).get(userId, month).t);
  const gastosUSDenRD = round2(gastosUSD * rate);
  const gastos = round2(gastosRD + gastosUSDenRD);
  const balance = round2(ingresos - gastos);
  const ahorroPct = ingresos > 0 ? round2((balance / ingresos) * 100) : 0;

  const txCount = db.prepare(
    "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND fecha_sort LIKE ? || '%'"
  ).get(userId, month).n;

  const isCurrentMonth = month === currentMonthKey();
  const [y, m] = month.split('-').map(Number);
  const diasTranscurridos = isCurrentMonth ? Number(todayLocalISO().slice(8, 10)) : daysInMonth(y, m);
  const gastoDiarioProm = diasTranscurridos > 0 ? round2(gastos / diasTranscurridos) : 0;

  const ultimoRow = db.prepare(`
    SELECT monto_num, moneda, fecha_sort FROM transactions
    WHERE user_id = ? AND ${INGRESO_CLAUSE} AND fecha_sort LIKE ? || '%'
    ORDER BY fecha_sort DESC, id DESC LIMIT 1
  `).get(userId, month);
  const ultimoIngreso = ultimoRow
    ? { montoNum: ultimoRow.monto_num, moneda: ultimoRow.moneda, fechaSort: ultimoRow.fecha_sort }
    : null;

  const prevMeses = db.prepare(`
    SELECT substr(fecha_sort, 1, 7) AS mk, SUM(${MONTO_RD_EXPR}) AS total
    FROM transactions WHERE user_id = ? AND ${INGRESO_CLAUSE} AND fecha_sort < ? || '-01'
    GROUP BY mk ORDER BY mk DESC LIMIT 3
  `).all(rate, userId, month);
  const promedio3m = prevMeses.length
    ? round2(prevMeses.reduce((a, r) => a + r.total, 0) / prevMeses.length)
    : 0;

  const ingresosPrev = round2(sumRD(INGRESO_CLAUSE, prevMonth));
  const gastosPrevRD = round2(db.prepare(`
    SELECT COALESCE(SUM(monto_num), 0) AS t FROM transactions
    WHERE user_id = ? AND ${GASTO_CLAUSE} AND moneda = 'RD$' AND fecha_sort LIKE ? || '%'
  `).get(userId, prevMonth).t);
  const gastosPrevUSD = round2(db.prepare(`
    SELECT COALESCE(SUM(monto_num), 0) AS t FROM transactions
    WHERE user_id = ? AND ${GASTO_CLAUSE} AND moneda = 'USD$' AND fecha_sort LIKE ? || '%'
  `).get(userId, prevMonth).t);
  const gastosPrev = round2(gastosPrevRD + gastosPrevUSD * rate);

  const porCategoria = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(cat), ''), '(sin categoría)') AS cat, SUM(${MONTO_RD_EXPR}) AS total
    FROM transactions WHERE user_id = ? AND ${GASTO_CLAUSE} AND fecha_sort LIKE ? || '%'
    GROUP BY cat ORDER BY total DESC LIMIT 5
  `).all(rate, userId, month).map((r) => ({ cat: r.cat, total: round2(r.total) }));

  const porMetodo = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(metodo), ''), '(sin método)') AS metodo, SUM(${MONTO_RD_EXPR}) AS total
    FROM transactions WHERE user_id = ? AND ${GASTO_CLAUSE} AND fecha_sort LIKE ? || '%'
    GROUP BY metodo ORDER BY total DESC LIMIT 5
  `).all(rate, userId, month).map((r) => ({ metodo: r.metodo, total: round2(r.total) }));

  const spentStmt = db.prepare(`
    SELECT COALESCE(SUM(${MONTO_RD_EXPR}), 0) AS g FROM transactions
    WHERE user_id = ? AND cat = ? AND ${GASTO_CLAUSE} AND fecha_sort LIKE ? || '%'
  `);
  const presupuesto = db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY cat').all(userId).map((b) => {
    const gastado = round2(spentStmt.get(rate, userId, b.cat, month).g);
    return { cat: b.cat, limite: b.monto, gastado, pct: b.monto > 0 ? round2((gastado / b.monto) * 100) : (gastado > 0 ? 100 : 0) };
  });

  return {
    month,
    kpis: { ingresos, gastos, balance, ahorroPct, gastoDiarioProm, gastosUSD, gastosUSDenRD, txCount },
    ultimoIngreso,
    promedio3m,
    vsAnterior: {
      prevMonth,
      ingresos: { actual: ingresos, prev: ingresosPrev, diff: round2(ingresos - ingresosPrev) },
      gastos: { actual: gastos, prev: gastosPrev, diff: round2(gastos - gastosPrev) }
    },
    porCategoria,
    porMetodo,
    presupuesto,
    prestamosEvolucion: prestamosEvolucion(userId, 6)
  };
}

router.get('/mensual', (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  res.json(buildMensual(req.user.id, month));
});

// ─── Tab Anual ──────────────────────────────────────────────────────

router.get('/anual', (req, res) => {
  const year = Number.isInteger(Number(req.query.year)) ? Number(req.query.year) : Number(currentMonthKey().slice(0, 4));
  const userId = req.user.id;
  const rate = getExchangeRate(userId).rate;

  const meses = [];
  for (let mo = 1; mo <= 12; mo++) {
    const mk = `${year}-${String(mo).padStart(2, '0')}`;
    const ingresos = round2(db.prepare(`
      SELECT COALESCE(SUM(${MONTO_RD_EXPR}), 0) AS t FROM transactions
      WHERE user_id = ? AND ${INGRESO_CLAUSE} AND fecha_sort LIKE ? || '%'
    `).get(rate, userId, mk).t);
    const gastos = round2(db.prepare(`
      SELECT COALESCE(SUM(${MONTO_RD_EXPR}), 0) AS t FROM transactions
      WHERE user_id = ? AND ${GASTO_CLAUSE} AND fecha_sort LIKE ? || '%'
    `).get(rate, userId, mk).t);
    const txCount = db.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND fecha_sort LIKE ? || '%'"
    ).get(userId, mk).n;
    const balance = round2(ingresos - gastos);
    meses.push({
      mesKey: mk, ingresos, gastos, balance, txCount,
      ahorroPct: ingresos > 0 ? round2((balance / ingresos) * 100) : 0,
      conDatos: txCount > 0
    });
  }

  const totales = meses.reduce((a, m) => ({
    ingresos: round2(a.ingresos + m.ingresos),
    gastos: round2(a.gastos + m.gastos)
  }), { ingresos: 0, gastos: 0 });

  const mejorMes = meses.reduce((best, m) => (!best || m.balance > best.balance ? m : best), null);

  res.json({ year, meses, totales: { ...totales, balance: round2(totales.ingresos - totales.gastos) }, mejorMes });
});

// ─── Tab Proyección ─────────────────────────────────────────────────

router.get('/proyeccion', (req, res) => {
  const userId = req.user.id;
  const horizonte = [3, 6, 12].includes(Number(req.query.horizonte)) ? Number(req.query.horizonte) : 6;
  const escenario = ['optimista', 'pesimista'].includes(req.query.escenario) ? req.query.escenario : 'base';
  const rate = getExchangeRate(userId).rate;
  const month = currentMonthKey();

  const mensualActual = buildMensual(userId, month);
  const ingBase = req.query.ingreso !== undefined && req.query.ingreso !== '' ? Number(req.query.ingreso) : mensualActual.kpis.ingresos;
  const gasBase = req.query.gasto !== undefined && req.query.gasto !== '' ? Number(req.query.gasto) : mensualActual.kpis.gastos;
  const extraPag = req.query.extra !== undefined && req.query.extra !== '' ? Number(req.query.extra) : 0;
  if (!Number.isFinite(ingBase) || ingBase < 0) return res.status(400).json({ error: 'ingreso inválido' });
  if (!Number.isFinite(gasBase) || gasBase < 0) return res.status(400).json({ error: 'gasto inválido' });
  if (!Number.isFinite(extraPag) || extraPag < 0) return res.status(400).json({ error: 'extra inválido' });

  const factor = escenario === 'optimista' ? 1.10 : escenario === 'pesimista' ? 0.90 : 1.0;
  const ingMes = round2(ingBase * factor);
  const gasMes = round2(gasBase * (2 - factor));

  const loans = db.prepare('SELECT * FROM loans WHERE user_id = ? AND activo = 1 AND saldo_pendiente > 0').all(userId);
  const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ? AND activo = 1').all(userId);
  const deudaPrestamosIni = round2(loans.reduce((a, l) => a + l.saldo_pendiente, 0));
  const deudaTarjetasIni = round2(cards.reduce((a, c) => a + Math.max(0, c.used_rd) + Math.max(0, c.used_usd) * rate, 0));
  let deudaTotal = round2(deudaPrestamosIni + deudaTarjetasIni);

  const meses = [];
  let balAcum = 0;
  let mk = month;
  for (let i = 0; i <= horizonte; i++) {
    if (i === 0) {
      meses.push({ n: 0, mesKey: mk, balance: 0, ingresos: 0, gastos: 0, deuda: deudaTotal });
    } else {
      mk = addMonthsToKey(mk, 1);
      balAcum = round2(balAcum + (ingMes - gasMes - extraPag));
      deudaTotal = round2(Math.max(0, deudaTotal - extraPag));
      meses.push({ n: i, mesKey: mk, balance: balAcum, ingresos: ingMes, gastos: gasMes, deuda: deudaTotal });
    }
  }

  const goals = db.prepare('SELECT * FROM goals WHERE user_id = ? AND activo = 1').all(userId)
    .map((g) => ({ ...g, falta_rd: round2(Math.max(0, g.objetivo - g.actual) * (g.moneda === 'USD$' ? rate : 1)) }))
    .filter((g) => g.falta_rd > 0);
  const ahorroTotalProy = Math.max(0, meses[meses.length - 1].balance);
  const metasAlcanzables = goals.map((g) => ({
    nombre: g.nombre,
    faltaRD: g.falta_rd,
    alcanzable: ahorroTotalProy >= g.falta_rd,
    pct: g.falta_rd > 0 ? round2(Math.min(100, (ahorroTotalProy / g.falta_rd) * 100)) : 100
  }));

  res.json({
    horizonte,
    escenario,
    supuestos: { ingreso: ingBase, gasto: gasBase, extra: extraPag },
    meses,
    kpis: {
      balanceFinal: meses[meses.length - 1].balance,
      ahorroMensualProy: round2(Math.max(0, ingMes - gasMes)),
      deudaFinal: meses[meses.length - 1].deuda,
      escenario
    },
    deudaDesglose: {
      prestamos: loans.map((l) => ({ nombre: l.nombre, saldoActual: l.saldo_pendiente })),
      tarjetasTotal: deudaTarjetasIni
    },
    ahorroTotalProy: round2(ahorroTotalProy),
    metasAlcanzables
  });
});

// ─── Tab Pagos extra ────────────────────────────────────────────────

router.get('/pagos-extra', (req, res) => {
  const userId = req.user.id;
  const loanId = req.query.loanId && req.query.loanId !== 'all' ? Number(req.query.loanId) : null;

  const loans = db.prepare('SELECT * FROM loans WHERE user_id = ?').all(userId);
  const loanMap = new Map(loans.map((l) => [l.id, l]));

  let pagos = db.prepare(`
    SELECT id, loan_id, nombre, monto_num, fecha_sort FROM transactions
    WHERE user_id = ? AND loan_id IS NOT NULL AND nombre LIKE 'Abono extra%'
    ORDER BY fecha_sort DESC, id DESC
  `).all(userId);
  if (loanId) pagos = pagos.filter((p) => p.loan_id === loanId);

  let totalAbonado = 0;
  let penalizacionesPagadas = 0;
  let interesEvitadoEst = 0;
  const enriquecidos = pagos.map((p) => {
    const loan = loanMap.get(p.loan_id);
    const pct = loan ? loan.penalidad_pct : 0;
    const capital = round2(p.monto_num / (1 + pct / 100));
    const penalizacion = round2(p.monto_num - capital);
    totalAbonado += capital;
    penalizacionesPagadas += penalizacion;
    interesEvitadoEst += capital * ((loan ? loan.tasa_anual : 0) / 100);
    return {
      id: p.id,
      loanNombre: loan ? loan.nombre : '(préstamo eliminado)',
      fechaSort: p.fecha_sort,
      abono: capital,
      penalizacion,
      total: p.monto_num
    };
  });
  totalAbonado = round2(totalAbonado);

  const porAnio = {};
  for (const p of enriquecidos) {
    const anio = p.fechaSort.slice(0, 4);
    if (!porAnio[anio]) porAnio[anio] = { anio, pagos: [], totalAbono: 0 };
    porAnio[anio].pagos.push(p);
    porAnio[anio].totalAbono = round2(porAnio[anio].totalAbono + p.abono);
  }
  const anios = Object.values(porAnio).sort((a, b) => b.anio.localeCompare(a.anio));
  const maxAnio = anios.length ? Math.max(...anios.map((a) => a.totalAbono)) : 1;
  anios.forEach((a) => { a.pctVsMax = maxAnio > 0 ? round2((a.totalAbono / maxAnio) * 100) : 0; });

  res.json({
    loans: loans.map((l) => ({ id: l.id, nombre: l.nombre })),
    kpis: {
      totalAbonado,
      promedioPorPago: enriquecidos.length ? round2(totalAbonado / enriquecidos.length) : 0,
      penalizacionesPagadas: round2(penalizacionesPagadas),
      interesEvitadoEst: round2(interesEvitadoEst)
    },
    porAnio: anios
  });
});

// ─── Asesor: motor de recomendaciones determinista ─────────────────
// Reemplaza al "Asesor IA" del documento (llamada externa a Claude): en
// vez de depender de una API con costo/latencia/credenciales nuevas,
// analiza los datos reales del usuario con reglas fijas y devuelve el
// mismo contrato { salud, mensaje_general, recomendaciones } para que la
// UI se comporte igual.
const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRD = (n) => `RD$${fmt2.format(Math.round((Number(n) || 0) * 100) / 100)}`;
const SEVERIDAD = { urgente: 3, importante: 2, atencion: 1, optimizar: 1, ahorro: 0 };

router.get('/recomendaciones', (req, res) => {
  const userId = req.user.id;
  const month = currentMonthKey();
  const mensual = buildMensual(userId, month);
  const prevMensual = buildMensual(userId, mensual.vsAnterior.prevMonth);
  const recomendaciones = [];

  if (mensual.kpis.balance < 0) {
    recomendaciones.push({
      tipo: 'urgente', titulo: 'Estás gastando más de lo que ingresas',
      descripcion: `Este mes tus gastos (${fmtRD(mensual.kpis.gastos)}) superan tus ingresos (${fmtRD(mensual.kpis.ingresos)}) por ${fmtRD(-mensual.kpis.balance)}.`
    });
  } else if (mensual.kpis.ahorroPct < 10) {
    recomendaciones.push({
      tipo: 'atencion', titulo: 'Tasa de ahorro baja',
      descripcion: `Estás ahorrando solo el ${mensual.kpis.ahorroPct}% de tus ingresos este mes (${fmtRD(mensual.kpis.balance)}). Revisa tus gastos discrecionales.`
    });
  } else if (mensual.kpis.ahorroPct >= 30) {
    recomendaciones.push({
      tipo: 'ahorro', titulo: 'Buena tasa de ahorro',
      descripcion: `Estás ahorrando el ${mensual.kpis.ahorroPct}% de tus ingresos (${fmtRD(mensual.kpis.balance)}) este mes. Considera destinar parte a una meta.`
    });
  }

  const prevCatMap = new Map(prevMensual.porCategoria.map((c) => [c.cat, c.total]));
  const catsEnAlza = mensual.porCategoria
    .map((c) => ({ ...c, prev: prevCatMap.get(c.cat) || 0 }))
    .filter((c) => c.prev > 0 && c.total >= c.prev * 1.3 && c.total - c.prev >= 1000)
    .sort((a, b) => (b.total - b.prev) - (a.total - a.prev));
  if (catsEnAlza.length) {
    const c = catsEnAlza[0];
    const subida = round2(((c.total - c.prev) / c.prev) * 100);
    recomendaciones.push({
      tipo: 'optimizar', titulo: `Gasto en ${c.cat} subió`,
      descripcion: `Gastaste ${fmtRD(c.total)} en ${c.cat} este mes, ${subida}% más que el mes anterior (${fmtRD(c.prev)}).`
    });
  }

  const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ? AND activo = 1').all(userId);
  for (const c of cards) {
    if (c.used_rd <= 0) continue;
    const uso = c.limit_rd > 0 ? (c.used_rd / c.limit_rd) * 100 : 0;
    const intMes = c.used_rd * (c.tasa_interes / 100 / 12);
    const pagoMin = c.used_rd * c.pago_minimo_pct / 100;
    if (pagoMin <= intMes) {
      recomendaciones.push({
        tipo: 'urgente', titulo: `${c.label}: el pago mínimo no cubre el interés`,
        descripcion: `Si solo pagas el mínimo (${fmtRD(pagoMin)}), tu deuda seguirá creciendo — el interés de este mes ya es ${fmtRD(intMes)}.`
      });
    } else if (uso >= 100) {
      recomendaciones.push({
        tipo: 'urgente', titulo: `${c.label} superó su límite`,
        descripcion: `Usaste ${fmtRD(c.used_rd)} de un límite de ${fmtRD(c.limit_rd)} (${uso.toFixed(0)}%).`
      });
    } else if (uso >= 80) {
      recomendaciones.push({
        tipo: 'importante', titulo: `${c.label} cerca del límite`,
        descripcion: `Estás usando el ${uso.toFixed(0)}% de tu límite (${fmtRD(c.used_rd)} de ${fmtRD(c.limit_rd)}).`
      });
    }
  }

  for (const b of mensual.presupuesto) {
    if (b.pct > 100) {
      recomendaciones.push({
        tipo: 'urgente', titulo: `Presupuesto de ${b.cat} superado`,
        descripcion: `Gastaste ${fmtRD(b.gastado)} de un límite de ${fmtRD(b.limite)} (${b.pct}%).`
      });
    }
  }

  const hoy = todayLocalISO();
  const goals = db.prepare('SELECT * FROM goals WHERE user_id = ? AND activo = 1').all(userId);
  for (const g of goals) {
    if (g.actual >= g.objetivo) continue;
    const diasTotal = Math.max(1, daysBetween(g.fecha_inicio, g.fecha_limite));
    const diasLeft = Math.max(0, daysBetween(hoy, g.fecha_limite));
    const pctTiempo = Math.min(100, ((diasTotal - diasLeft) / diasTotal) * 100);
    const pct = Math.min(100, (g.actual / g.objetivo) * 100);
    if (diasLeft > 0 && pct < pctTiempo * 0.7) {
      recomendaciones.push({
        tipo: 'atencion', titulo: `Meta "${g.nombre}" atrasada`,
        descripcion: `Llevas ${pct.toFixed(0)}% ahorrado pero ya pasó el ${pctTiempo.toFixed(0)}% del tiempo. Aumenta tus abonos para llegar a tiempo.`
      });
    }
  }

  recomendaciones.sort((a, b) => SEVERIDAD[b.tipo] - SEVERIDAD[a.tipo]);
  const top = recomendaciones.slice(0, 6);

  const peorSeveridad = top.length ? Math.max(...top.map((r) => SEVERIDAD[r.tipo])) : 0;
  const salud = peorSeveridad >= 3 ? 'critica' : peorSeveridad === 2 ? 'atencion' : peorSeveridad === 1 ? 'buena' : 'excelente';
  const mensajeGeneral = mensual.kpis.balance < 0
    ? 'Tus gastos superan tus ingresos este mes — hay que actuar.'
    : salud === 'excelente'
      ? 'Tus finanzas están saludables este mes.'
      : salud === 'buena'
        ? 'Vas bien, con algunos puntos a vigilar.'
        : 'Hay temas que requieren tu atención este mes.';

  res.json({ salud, mensajeGeneral, recomendaciones: top });
});

// ─── Exportación PDF / Excel ────────────────────────────────────────
// Server-side (pdfkit / exceljs, instalados vía npm): sin CDN, sin exponer
// datos financieros a un script de terceros cargado en el navegador.

const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const monthLabel = (mk) => `${MESES_LARGO[Number(mk.slice(5, 7)) - 1]} ${mk.slice(0, 4)}`;

function monthTransactions(userId, month) {
  return db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? AND fecha_sort LIKE ? || '%'
    ORDER BY fecha_sort DESC, id DESC
  `).all(userId, month).map(rowToTx);
}

router.get('/export/pdf', (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  const userId = req.user.id;
  const mensual = buildMensual(userId, month);
  const rate = getExchangeRate(userId).rate;
  const txs = monthTransactions(userId, month).slice(0, 50);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-financiero-${month}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, 80).fill('#0f1117');
  doc.fillColor('#7c6fef').fontSize(18).font('Helvetica-Bold').text('Centro Financiero Personal', 40, 20);
  doc.fillColor('#8a90a8').fontSize(10).font('Helvetica')
    .text(`Reporte — ${monthLabel(month)} · ${req.user.username || 'Usuario'}`, 40, 44)
    .text(`Generado: ${todayLocalISO()}`, 40, 58);
  doc.fillColor('#000000');

  let y = 100;
  doc.fontSize(13).font('Helvetica-Bold').text('Resumen del período', 40, y);
  y += 20;
  const kpiRows = [
    ['Ingresos del mes', fmtRD(mensual.kpis.ingresos)],
    ['Gastos del mes', fmtRD(mensual.kpis.gastos)],
    ['Balance neto', `${mensual.kpis.balance >= 0 ? '+' : ''}${fmtRD(mensual.kpis.balance)}`],
    ['Gastos en USD$', `USD$${round2(mensual.kpis.gastosUSD).toFixed(2)}`],
    ['Tasa de cambio USD/RD$', String(rate)],
    ['Tasa de ahorro', `${mensual.kpis.ahorroPct}%`]
  ];
  doc.fontSize(10).font('Helvetica');
  for (const [label, val] of kpiRows) {
    doc.text(label, 40, y).text(val, 350, y);
    y += 16;
  }

  y += 14;
  doc.fontSize(13).font('Helvetica-Bold').text('Transacciones del período', 40, y);
  y += 20;
  const cols = [
    { label: 'Fecha', x: 40, w: 60 },
    { label: 'Descripción', x: 100, w: 180 },
    { label: 'Categoría', x: 280, w: 110 },
    { label: 'Método', x: 390, w: 90 },
    { label: 'Monto', x: 480, w: 75 }
  ];
  const drawRow = (cells, opts = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    cols.forEach((c, i) => doc.text(String(cells[i] ?? ''), c.x, y, { width: c.w, ellipsis: true }));
    y += 15;
  };
  doc.rect(40, y - 2, 515, 16).fill('#7c6fef');
  doc.fillColor('#ffffff');
  drawRow(cols.map((c) => c.label), { bold: true });
  doc.fillColor('#000000');
  for (const t of txs) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
    drawRow([
      `${t.fechaSort.slice(8, 10)}/${t.fechaSort.slice(5, 7)}`,
      t.nombre, t.cat || '', t.metodo || '',
      `${t.neg ? '-' : '+'}${t.moneda === 'USD$' ? 'USD$' : 'RD$'}${round2(t.montoNum).toFixed(2)}`
    ]);
  }
  if (txs.length === 0) { doc.fontSize(9).fillColor('#8a90a8').text('Sin transacciones en este período', 40, y); }

  if (y > doc.page.height - 160) { doc.addPage(); y = 40; } else { y += 20; }
  const loans = db.prepare('SELECT * FROM loans WHERE user_id = ? AND activo = 1').all(userId);
  if (loans.length) {
    doc.fillColor('#000000').fontSize(13).font('Helvetica-Bold').text('Préstamos activos', 40, y);
    y += 20;
    for (const l of loans) {
      doc.fontSize(9).font('Helvetica')
        .text(`${l.nombre} (${l.banco || 'sin banco'}) — Saldo: ${fmtRD(l.saldo_pendiente)} · Cuota: ${fmtRD(l.cuota_mensual)}`, 40, y);
      y += 14;
    }
  }

  doc.end();
});

router.get('/export/excel', async (req, res) => {
  const month = req.query.month && isValidMonthKey(req.query.month) ? req.query.month : currentMonthKey();
  const userId = req.user.id;
  const mensual = buildMensual(userId, month);
  const rate = getExchangeRate(userId).rate;
  const txs = monthTransactions(userId, month);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Centro Financiero Personal';
  wb.created = new Date();

  const resumen = wb.addWorksheet('Resumen');
  resumen.columns = [{ width: 28 }, { width: 20 }];
  resumen.addRows([
    [`Centro Financiero Personal — ${monthLabel(month)}`],
    [],
    ['RESUMEN'],
    ['Ingresos del mes', mensual.kpis.ingresos],
    ['Gastos del mes', mensual.kpis.gastos],
    ['Balance neto', mensual.kpis.balance],
    ['Gastos USD$', mensual.kpis.gastosUSD],
    ['Tasa USD/RD$', rate],
    ['Tasa de ahorro %', mensual.kpis.ahorroPct]
  ]);
  resumen.getCell('A1').font = { bold: true, size: 14 };
  resumen.getCell('A3').font = { bold: true };

  const gastosSheet = wb.addWorksheet('Gastos');
  gastosSheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Descripción', key: 'nombre', width: 28 },
    { header: 'Categoría', key: 'cat', width: 18 },
    { header: 'Método', key: 'metodo', width: 16 },
    { header: 'Monto', key: 'monto', width: 14 },
    { header: 'Moneda', key: 'moneda', width: 10 },
    { header: 'Etiquetas', key: 'tags', width: 20 }
  ];
  gastosSheet.getRow(1).font = { bold: true };
  for (const t of txs.filter((t) => t.neg)) {
    gastosSheet.addRow({
      fecha: t.fechaSort, nombre: t.nombre, cat: t.cat || '', metodo: t.metodo || '',
      monto: t.montoNum, moneda: t.moneda, tags: (t.tags || []).join(', ')
    });
  }

  const ingresosSheet = wb.addWorksheet('Ingresos');
  ingresosSheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Descripción', key: 'nombre', width: 28 },
    { header: 'Fuente', key: 'fuente', width: 18 },
    { header: 'Monto RD$', key: 'monto', width: 14 }
  ];
  ingresosSheet.getRow(1).font = { bold: true };
  for (const t of txs.filter((t) => !t.neg && !t.isPagoTarjeta)) {
    ingresosSheet.addRow({ fecha: t.fechaSort, nombre: t.nombre, fuente: t.fuente || '', monto: t.montoNum });
  }

  const presSheet = wb.addWorksheet('Presupuesto');
  presSheet.columns = [
    { header: 'Categoría', key: 'cat', width: 20 },
    { header: 'Límite RD$', key: 'limite', width: 14 },
    { header: 'Gastado RD$', key: 'gastado', width: 14 },
    { header: '% Usado', key: 'pct', width: 12 },
    { header: 'Disponible', key: 'disp', width: 14 }
  ];
  presSheet.getRow(1).font = { bold: true };
  for (const b of mensual.presupuesto) {
    presSheet.addRow({ cat: b.cat, limite: b.limite, gastado: b.gastado, pct: b.pct, disp: round2(b.limite - b.gastado) });
  }

  const loansSheet = wb.addWorksheet('Prestamos');
  loansSheet.columns = [
    { header: 'Préstamo', key: 'nombre', width: 22 },
    { header: 'Banco', key: 'banco', width: 16 },
    { header: 'Original', key: 'original', width: 14 },
    { header: 'Saldo', key: 'saldo', width: 14 },
    { header: 'Capital pagado', key: 'capital', width: 16 },
    { header: '% Pagado', key: 'pct', width: 12 },
    { header: 'Cuota', key: 'cuota', width: 14 }
  ];
  loansSheet.getRow(1).font = { bold: true };
  for (const l of db.prepare('SELECT * FROM loans WHERE user_id = ?').all(userId)) {
    const capital = round2(l.original - l.saldo_pendiente);
    loansSheet.addRow({
      nombre: l.nombre, banco: l.banco || '', original: l.original, saldo: l.saldo_pendiente,
      capital, pct: round2((capital / l.original) * 100), cuota: l.cuota_mensual
    });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-financiero-${month}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
