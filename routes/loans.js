const express = require('express');
const db = require('../db/database');
const { isValidFechaSort, todayLocalISO, quincenaOf, addMonthsToKey, dateInMonth, monthKey } = require('../lib/dates');
const { frenchPayment, splitCuota, round2, RESIDUO_SALDO } = require('../lib/amortization');
const { getExchangeRate } = require('../lib/settings');

// Piso del pago mínimo de tarjeta usado en la estrategia de deudas —
// mismo valor que PAGO_MINIMO_PISO_RD en public/js/views/tarjetas.js
// (proyección de salud crediticia), para que ambas simulaciones coincidan.
const PAGO_MINIMO_PISO_RD = 500;

const router = express.Router();

const findById = db.prepare('SELECT * FROM loans WHERE user_id = ? AND id = ?');
const listStmt = db.prepare('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at');
const sumPagosStmt = db.prepare(
  'SELECT COALESCE(SUM(monto_num), 0) AS total, COUNT(*) AS n FROM transactions WHERE user_id = ? AND loan_id = ?'
);

// Meses restantes con la cuota actual, por simulación (los abonos extra
// hacen que plazo_meses - cuotas_pagadas deje de ser confiable)
function mesesRestantes(saldo, tasaAnual, cuota) {
  const i = tasaAnual / 100 / 12;
  let s = saldo;
  let meses = 0;
  while (s > RESIDUO_SALDO && meses < 600) {
    const interes = s * i;
    if (cuota <= interes + 0.01) return Infinity;
    s -= (cuota - interes);
    meses++;
  }
  return meses;
}

// Interés total que falta por pagar con la cuota actual
function interesRestante(saldo, tasaAnual, cuota) {
  const i = tasaAnual / 100 / 12;
  let s = saldo;
  let interes = 0;
  let meses = 0;
  while (s > RESIDUO_SALDO && meses < 600) {
    const int = s * i;
    if (cuota <= int + 0.01) return Infinity;
    interes += int;
    s -= (cuota - int);
    meses++;
  }
  return round2(interes);
}

function serializeLoan(row, userId) {
  const nextKey = addMonthsToKey(monthKey(row.fecha_inicio), row.cuotas_pagadas + 1);
  const pagos = sumPagosStmt.get(userId, row.id);
  // Interés/cargos pagados = todo lo desembolsado menos lo que bajó el capital
  const capitalAmortizado = round2(row.original - row.saldo_pendiente);
  const interesPagado = round2(Math.max(0, pagos.total - capitalAmortizado));
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
    penalidadPct: row.penalidad_pct,
    activo: !!row.activo,
    saldado: row.saldo_pendiente <= 0,
    progresoPct: round2(Math.min(100, ((row.original - row.saldo_pendiente) / row.original) * 100)),
    proximaCuotaFecha: row.saldo_pendiente > 0 ? dateInMonth(nextKey, row.dia_pago) : null,
    interesPagado,
    totalDesembolsado: round2(pagos.total),
    numPagos: pagos.n
  };
}

router.get('/', (req, res) => {
  res.json(listStmt.all(req.user.id).map((l) => serializeLoan(l, req.user.id)));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

  const original = Number(b.original);
  const tasaAnual = Number(b.tasaAnual);
  const plazoMeses = Number(b.plazoMeses);
  const diaPago = Number(b.diaPago);
  const penalidadPct = b.penalidadPct !== undefined && b.penalidadPct !== '' ? Number(b.penalidadPct) : 0;
  if (!Number.isFinite(original) || original <= 0) return res.status(400).json({ error: 'original debe ser mayor que 0' });
  if (!Number.isFinite(tasaAnual) || tasaAnual < 0) return res.status(400).json({ error: 'tasaAnual inválida' });
  if (!Number.isInteger(plazoMeses) || plazoMeses <= 0) return res.status(400).json({ error: 'plazoMeses debe ser entero positivo' });
  if (!Number.isInteger(diaPago) || diaPago < 1 || diaPago > 31) return res.status(400).json({ error: 'diaPago debe ser 1-31' });
  if (!Number.isFinite(penalidadPct) || penalidadPct < 0 || penalidadPct > 100) return res.status(400).json({ error: 'penalidadPct inválida (0-100)' });
  const fechaInicio = b.fechaInicio || todayLocalISO();
  if (!isValidFechaSort(fechaInicio)) return res.status(400).json({ error: 'fechaInicio inválida (yyyy-mm-dd)' });

  // Cuota personalizada: los bancos redondean distinto o incluyen seguros
  // en la cuota, así que el valor teórico puede no cuadrar con el estado
  // de cuenta. Se acepta cualquier cuota que amortice.
  let cuota = round2(frenchPayment(original, tasaAnual, plazoMeses));
  if (b.cuotaMensual !== undefined && b.cuotaMensual !== '' && b.cuotaMensual !== null) {
    cuota = Number(b.cuotaMensual);
    if (!Number.isFinite(cuota) || cuota <= 0) return res.status(400).json({ error: 'cuotaMensual inválida' });
    const interesMes1 = original * tasaAnual / 100 / 12;
    if (cuota <= interesMes1 + 0.01) {
      return res.status(400).json({ error: `La cuota no cubre el interés mensual (RD$${round2(interesMes1)}); el préstamo nunca amortizaría` });
    }
    cuota = round2(cuota);
  }

  // Préstamo que ya venía pagándose antes de usar la app: se simula la
  // amortización de esas cuotas para derivar el saldo actual, SIN crear
  // transacciones — esos pagos no son gastos del presente ni del histórico.
  let cuotasPagadas = 0;
  if (b.cuotasPagadas !== undefined && b.cuotasPagadas !== '' && b.cuotasPagadas !== null) {
    cuotasPagadas = Number(b.cuotasPagadas);
    if (!Number.isInteger(cuotasPagadas) || cuotasPagadas < 0) {
      return res.status(400).json({ error: 'cuotasPagadas debe ser entero >= 0' });
    }
  }
  let saldo = original;
  for (let k = 0; k < cuotasPagadas && saldo > 0; k++) {
    const { capital } = splitCuota(saldo, tasaAnual, cuota);
    saldo = round2(Math.max(0, saldo - capital));
  }

  // Ajuste manual del saldo al valor exacto del banco (abonos extra o
  // cargos que la simulación no conoce)
  if (b.saldoActual !== undefined && b.saldoActual !== '' && b.saldoActual !== null) {
    const sa = Number(b.saldoActual);
    if (!Number.isFinite(sa) || sa < 0 || sa > original) {
      return res.status(400).json({ error: 'saldoActual inválido (entre 0 y el monto original)' });
    }
    saldo = round2(sa);
  }
  if (saldo <= 0) {
    return res.status(400).json({ error: 'Con esos valores el préstamo ya estaría saldado; no hay nada que registrar' });
  }

  const info = db.prepare(`
    INSERT INTO loans (user_id, nombre, banco, original, tasa_anual, plazo_meses,
                       cuota_mensual, dia_pago, fecha_inicio, saldo_pendiente, cuotas_pagadas, penalidad_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, nombre, b.banco ? String(b.banco) : null, original, tasaAnual,
    plazoMeses, cuota, diaPago, fechaInicio, saldo, cuotasPagadas, penalidadPct);

  res.status(201).json(serializeLoan(findById.get(req.user.id, info.lastInsertRowid), req.user.id));
});

// Proyección de las cuotas RESTANTES desde el saldo actual. Para un
// préstamo sin abonos extra equivale a la tabla francesa completa desde
// la cuota actual; tras un abono extra refleja la realidad, no el plan
// original. Las cuotas ya pagadas se consultan en GET /:id/pagos.
router.get('/:id/schedule', (req, res) => {
  const loan = findById.get(req.user.id, Number(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Préstamo no existe' });

  const schedule = [];
  let saldo = loan.saldo_pendiente;
  let key = addMonthsToKey(monthKey(loan.fecha_inicio), loan.cuotas_pagadas);
  let n = loan.cuotas_pagadas;
  let totalInteres = 0;
  while (saldo > 0.01 && schedule.length < 600) {
    const { interes, capital } = splitCuota(saldo, loan.tasa_anual, loan.cuota_mensual);
    if (capital <= 0) break; // cuota no cubre interés — no proyectable
    saldo = round2(Math.max(0, saldo - capital));
    key = addMonthsToKey(key, 1);
    n++;
    totalInteres += interes;
    schedule.push({
      n,
      fecha: dateInMonth(key, loan.dia_pago),
      cuota: round2(interes + capital),
      interes,
      capital,
      saldo
    });
  }
  res.json({
    cuotasPagadas: loan.cuotas_pagadas,
    saldoActual: loan.saldo_pendiente,
    interesRestante: round2(totalInteres),
    schedule
  });
});

// Historial real de pagos (cuotas + abonos extra) desde transactions
router.get('/:id/pagos', (req, res) => {
  const loan = findById.get(req.user.id, Number(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Préstamo no existe' });

  const pagos = db.prepare(`
    SELECT id, nombre, monto_num, fecha_sort FROM transactions
    WHERE user_id = ? AND loan_id = ? ORDER BY fecha_sort DESC, id DESC
  `).all(req.user.id, loan.id).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    monto: p.monto_num,
    fechaSort: p.fecha_sort,
    esAbonoExtra: p.nombre.startsWith('Abono extra')
  }));

  res.json({ pagos, loan: serializeLoan(loan, req.user.id) });
});

// Pago de cuota regular: separa interés/capital sobre el saldo actual
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
    loan: serializeLoan(findById.get(req.user.id, loan.id), req.user.id)
  });
});

// Calcula el efecto de un abono extra en ambos modos, sin escribir nada
function simularExtra(loan, monto) {
  const capitalAplicado = round2(Math.min(monto, loan.saldo_pendiente));
  const penalidad = round2(capitalAplicado * loan.penalidad_pct / 100);
  const nuevoSaldo = round2(loan.saldo_pendiente - capitalAplicado);

  const mesesSinAbono = mesesRestantes(loan.saldo_pendiente, loan.tasa_anual, loan.cuota_mensual);
  const interesSinAbono = interesRestante(loan.saldo_pendiente, loan.tasa_anual, loan.cuota_mensual);

  // Modo 1: reducir plazo — misma cuota, el préstamo termina antes
  const mesesReducirPlazo = nuevoSaldo > 0 ? mesesRestantes(nuevoSaldo, loan.tasa_anual, loan.cuota_mensual) : 0;
  const interesReducirPlazo = nuevoSaldo > 0 ? interesRestante(nuevoSaldo, loan.tasa_anual, loan.cuota_mensual) : 0;

  // Modo 2: reducir cuota — mismo plazo restante, cuota nueva más baja
  const nuevaCuota = nuevoSaldo > 0 && Number.isFinite(mesesSinAbono) && mesesSinAbono > 0
    ? round2(frenchPayment(nuevoSaldo, loan.tasa_anual, mesesSinAbono))
    : 0;
  const interesReducirCuota = nuevoSaldo > 0 && nuevaCuota > 0
    ? interesRestante(nuevoSaldo, loan.tasa_anual, nuevaCuota)
    : 0;

  return {
    capitalAplicado,
    penalidad,
    totalDesembolso: round2(capitalAplicado + penalidad),
    nuevoSaldo,
    liquidaPrestamo: nuevoSaldo <= 0,
    sinAbono: { meses: mesesSinAbono, interes: interesSinAbono },
    reducirPlazo: {
      meses: mesesReducirPlazo,
      interes: interesReducirPlazo,
      cuota: loan.cuota_mensual,
      ahorroInteres: Number.isFinite(interesSinAbono) ? round2(interesSinAbono - interesReducirPlazo - penalidad) : null,
      mesesAhorrados: Number.isFinite(mesesSinAbono) ? mesesSinAbono - mesesReducirPlazo : null
    },
    reducirCuota: {
      meses: nuevoSaldo > 0 ? mesesSinAbono : 0,
      interes: interesReducirCuota,
      cuota: nuevaCuota,
      ahorroInteres: Number.isFinite(interesSinAbono) ? round2(interesSinAbono - interesReducirCuota - penalidad) : null,
      ahorroCuotaMensual: nuevoSaldo > 0 ? round2(loan.cuota_mensual - nuevaCuota) : loan.cuota_mensual
    }
  };
}

router.post('/:id/simular-extra', (req, res) => {
  const loan = findById.get(req.user.id, Number(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Préstamo no existe' });
  if (loan.saldo_pendiente <= 0) return res.status(400).json({ error: 'El préstamo ya está saldado' });
  const monto = Number((req.body || {}).monto);
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'monto debe ser mayor que 0' });
  res.json(simularExtra(loan, monto));
});

// Abono extraordinario a capital: reduce el saldo directamente. La
// penalidad es un cargo real (va en la transacción); el capital reduce
// deuda. En modo reducir_cuota la cuota mensual se recalcula.
router.post('/:id/pay-extra', (req, res) => {
  const loan = findById.get(req.user.id, Number(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Préstamo no existe' });
  if (loan.saldo_pendiente <= 0) return res.status(400).json({ error: 'El préstamo ya está saldado' });

  const b = req.body || {};
  const monto = Number(b.monto);
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'monto debe ser mayor que 0' });
  const modo = b.modo;
  if (modo !== 'reducir_plazo' && modo !== 'reducir_cuota') {
    return res.status(400).json({ error: "modo debe ser 'reducir_plazo' o 'reducir_cuota'" });
  }
  const fechaSort = b.fechaSort || todayLocalISO();
  if (!isValidFechaSort(fechaSort)) return res.status(400).json({ error: 'fechaSort inválido (yyyy-mm-dd)' });

  const sim = simularExtra(loan, monto);

  const apply = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (user_id, nombre, cat, metodo, monto_num, moneda, neg,
                                is_pago_prestamo, fecha_sort, quincena, loan_id)
      VALUES (?, ?, 'Préstamos', ?, ?, 'RD$', 1, 1, ?, ?, ?)
    `).run(req.user.id, `Abono extra ${loan.nombre}`, loan.banco || 'Banco',
      sim.totalDesembolso, fechaSort, quincenaOf(fechaSort), loan.id);

    const nuevaCuota = modo === 'reducir_cuota' && !sim.liquidaPrestamo
      ? sim.reducirCuota.cuota
      : loan.cuota_mensual;
    db.prepare('UPDATE loans SET saldo_pendiente = ?, cuota_mensual = ? WHERE id = ?')
      .run(sim.nuevoSaldo, nuevaCuota, loan.id);
  });
  apply();

  res.status(201).json({
    ok: true,
    modo,
    aplicado: { capital: sim.capitalAplicado, penalidad: sim.penalidad, total: sim.totalDesembolso },
    loan: serializeLoan(findById.get(req.user.id, loan.id), req.user.id)
  });
});

// Pago mensual de una deuda: fijo para préstamos (cuota francesa), pero
// recalculado sobre el saldo VIGENTE para tarjetas (el mínimo baja junto
// con el saldo, igual que en la proyección de salud crediticia).
function pagoMinimoDe(d) {
  return d.tipo === 'tarjeta'
    ? Math.max(d.saldo * d.pagoMinimoPct / 100, PAGO_MINIMO_PISO_RD)
    : d.cuota;
}

// Estrategias de pago de deudas: compara baseline vs bola de nieve
// (menor saldo primero) vs avalancha (mayor tasa primero) con un monto
// extra mensual. Unifica préstamos Y tarjetas de crédito — ambos son
// deuda con interés y deben atacarse juntos, no por separado (si solo
// se mostraran préstamos el plan estaría incompleto). Cuando una deuda
// se liquida, su pago mínimo se suma al extra disponible (bola de nieve).
// Simulación pura — no incluye penalidades por prepago.
router.get('/estrategia', (req, res) => {
  const extra = Number(req.query.extra) || 0;
  if (extra < 0) return res.status(400).json({ error: 'extra inválido' });

  const deudasLoans = listStmt.all(req.user.id)
    .filter((l) => l.activo && l.saldo_pendiente > 0)
    .map((l) => ({ nombre: l.nombre, saldo: l.saldo_pendiente, tasa: l.tasa_anual, tipo: 'prestamo', cuota: l.cuota_mensual }));

  const rate = getExchangeRate(req.user.id).rate;
  const deudasCards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(req.user.id)
    .map((c) => ({
      nombre: c.label,
      saldo: round2(Math.max(0, c.used_rd) + Math.max(0, c.used_usd) * rate),
      tasa: c.tasa_interes,
      tipo: 'tarjeta',
      pagoMinimoPct: c.pago_minimo_pct
    }))
    .filter((c) => c.saldo > 0);

  const deudas = [...deudasLoans, ...deudasCards];
  if (deudas.length === 0) return res.json({ deudas: 0 });

  function simular(orden) {
    // orden: función que elige la deuda objetivo del extra cada mes
    const ls = deudas.map((d) => ({ ...d }));
    let meses = 0;
    let interesTotal = 0;
    let extraDisponible = extra;
    while (ls.some((l) => l.saldo > RESIDUO_SALDO) && meses < 600) {
      meses++;
      // pagos regulares (cuota fija o mínimo de tarjeta recalculado)
      for (const l of ls) {
        if (l.saldo <= RESIDUO_SALDO) continue;
        const int = l.saldo * (l.tasa / 100 / 12);
        interesTotal += int;
        const pagoMin = pagoMinimoDe(l);
        const cap = Math.min(Math.max(0, pagoMin - int), l.saldo);
        l.saldo = Math.max(0, l.saldo - cap);
        if (l.saldo <= RESIDUO_SALDO && !l.liquidado) {
          l.liquidado = true;
          extraDisponible += pagoMin; // su pago mínimo rueda al extra
        }
      }
      // extra al objetivo
      if (extraDisponible > 0) {
        const vivos = ls.filter((l) => l.saldo > RESIDUO_SALDO);
        if (vivos.length) {
          const target = orden(vivos);
          const pagoMinTarget = pagoMinimoDe(target);
          target.saldo = Math.max(0, target.saldo - extraDisponible);
          if (target.saldo <= RESIDUO_SALDO && !target.liquidado) {
            target.liquidado = true;
            extraDisponible += pagoMinTarget;
          }
        }
      }
    }
    return { meses: meses >= 600 ? Infinity : meses, interesTotal: round2(interesTotal) };
  }

  function simularSinExtra(base) {
    const ls = base.map((d) => ({ ...d }));
    let meses = 0;
    let interesTotal = 0;
    while (ls.some((l) => l.saldo > RESIDUO_SALDO) && meses < 600) {
      meses++;
      for (const l of ls) {
        if (l.saldo <= RESIDUO_SALDO) continue;
        const int = l.saldo * (l.tasa / 100 / 12);
        const pagoMin = pagoMinimoDe(l);
        if (pagoMin <= int + 0.01) return { meses: Infinity, interesTotal: Infinity };
        interesTotal += int;
        l.saldo = Math.max(0, l.saldo - (pagoMin - int));
      }
    }
    return { meses: meses >= 600 ? Infinity : meses, interesTotal: round2(interesTotal) };
  }

  const baseline = simularSinExtra(deudas);
  const nieve = simular((vivos) => vivos.reduce((a, b2) => (a.saldo < b2.saldo ? a : b2)));
  const avalancha = simular((vivos) => vivos.reduce((a, b2) => (a.tasa > b2.tasa ? a : b2)));

  const ordenNieve = [...deudas].sort((a, b2) => a.saldo - b2.saldo).map((d) => d.nombre);
  const ordenAvalancha = [...deudas].sort((a, b2) => b2.tasa - a.tasa).map((d) => d.nombre);

  res.json({
    deudas: deudas.length,
    prestamos: deudasLoans.length,
    tarjetas: deudasCards.length,
    extraMensual: extra,
    baseline,
    nieve: { ...nieve, orden: ordenNieve },
    avalancha: { ...avalancha, orden: ordenAvalancha },
    nota: 'La simulación no incluye penalidades por prepago.'
  });
});

// Simulación recurrente (pura, no escribe nada): compara la cuota normal
// contra pagar un extra fijo cada mes, o una cuota doble cada N meses.
// A diferencia de POST /:id/pay-extra, esto NO se puede "aplicar" en un
// solo clic — es un compromiso recurrente que el usuario ejecuta él mismo
// mes a mes (vía /pay o /pay-extra); esta ruta solo proyecta el resultado.
function simularRecurrente(loan, modo, params) {
  const i = loan.tasa_anual / 100 / 12;
  let saldo = loan.saldo_pendiente;
  let meses = 0;
  let interes = 0;
  while (saldo > RESIDUO_SALDO && meses < 600) {
    const int = saldo * i;
    let pago = loan.cuota_mensual;
    if (modo === 'mensual') pago += params.montoExtra;
    else if (meses % params.frecuencia === 0) pago += loan.cuota_mensual; // cuota doble
    if (pago <= int + 0.01) return { meses: Infinity, interes: Infinity };
    interes += int;
    saldo -= (pago - int);
    meses++;
  }
  return { meses, interes: round2(interes) };
}

router.post('/:id/simular-recurrente', (req, res) => {
  const loan = findById.get(req.user.id, Number(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Préstamo no existe' });
  if (loan.saldo_pendiente <= 0) return res.status(400).json({ error: 'El préstamo ya está saldado' });

  const b = req.body || {};
  const modo = b.modo;
  if (modo !== 'mensual' && modo !== 'doble') {
    return res.status(400).json({ error: "modo debe ser 'mensual' o 'doble'" });
  }

  const params = {};
  if (modo === 'mensual') {
    params.montoExtra = Number(b.montoExtra);
    if (!Number.isFinite(params.montoExtra) || params.montoExtra <= 0) {
      return res.status(400).json({ error: 'montoExtra debe ser mayor que 0' });
    }
  } else {
    params.frecuencia = Number(b.frecuenciaMeses);
    if (!Number.isInteger(params.frecuencia) || params.frecuencia < 1) {
      return res.status(400).json({ error: 'frecuenciaMeses debe ser entero >= 1' });
    }
  }

  const baseline = {
    meses: mesesRestantes(loan.saldo_pendiente, loan.tasa_anual, loan.cuota_mensual),
    interes: interesRestante(loan.saldo_pendiente, loan.tasa_anual, loan.cuota_mensual)
  };
  const conExtra = simularRecurrente(loan, modo, params);

  res.json({
    baseline,
    conExtra,
    ahorroInteres: Number.isFinite(baseline.interes) && Number.isFinite(conExtra.interes)
      ? round2(baseline.interes - conExtra.interes) : null,
    mesesAhorrados: Number.isFinite(baseline.meses) && Number.isFinite(conExtra.meses)
      ? baseline.meses - conExtra.meses : null
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
  let penalidadPct = loan.penalidad_pct;
  if (b.penalidadPct !== undefined) {
    penalidadPct = Number(b.penalidadPct);
    if (!Number.isFinite(penalidadPct) || penalidadPct < 0 || penalidadPct > 100) return res.status(400).json({ error: 'penalidadPct inválida (0-100)' });
  }
  const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : loan.activo;

  db.prepare('UPDATE loans SET nombre = ?, banco = ?, dia_pago = ?, penalidad_pct = ?, activo = ? WHERE user_id = ? AND id = ?')
    .run(nombre, banco, diaPago, penalidadPct, activo, req.user.id, loan.id);
  res.json(serializeLoan(findById.get(req.user.id, loan.id), req.user.id));
});

router.delete('/:id', (req, res) => {
  const loan = findById.get(req.user.id, Number(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Préstamo no existe' });
  const remove = db.transaction(() => {
    // Sus pagos se conservan como gastos históricos normales (editables);
    // sin esto quedarían bloqueados para siempre por el guard de loan_id
    db.prepare('UPDATE transactions SET loan_id = NULL WHERE user_id = ? AND loan_id = ?')
      .run(req.user.id, loan.id);
    db.prepare('DELETE FROM loans WHERE user_id = ? AND id = ?').run(req.user.id, loan.id);
  });
  remove();
  res.json({ ok: true });
});

module.exports = router;
