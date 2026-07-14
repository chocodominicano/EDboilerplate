const express = require('express');
const db = require('../db/database');
const { isValidFechaSort, todayLocalISO, quincenaOf, daysBetween, addDaysISO } = require('../lib/dates');
const { round2 } = require('../lib/amortization');
const { getExchangeRate } = require('../lib/settings');

const router = express.Router();

const findById = db.prepare('SELECT * FROM goals WHERE user_id = ? AND id = ?');
const listStmt = db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY created_at');

// Estado calculado de una meta: progreso, cadencia necesaria, ritmo actual
// y proyección de fecha de llegada, y semáforo de salud (dinero vs tiempo).
function serializeGoal(row) {
  const hoy = todayLocalISO();
  const diasTotal = Math.max(1, daysBetween(row.fecha_inicio, row.fecha_limite));
  const diasLeft = Math.max(0, daysBetween(hoy, row.fecha_limite));
  const diasPasados = Math.max(0, diasTotal - diasLeft);
  const falta = Math.max(0, round2(row.objetivo - row.actual));
  const pct = round2(Math.min(100, (row.actual / row.objetivo) * 100));
  const pctTiempo = round2(Math.min(100, (diasPasados / diasTotal) * 100));
  const completada = row.actual >= row.objetivo;

  const cadencia = diasLeft > 0 && falta > 0 ? {
    porDia: Math.ceil(falta / diasLeft),
    porSemana: Math.ceil(falta / Math.max(1, diasLeft / 7)),
    porQuincena: Math.ceil(falta / Math.max(1, diasLeft / 15)),
    porMes: Math.ceil(falta / Math.max(1, diasLeft / 30))
  } : { porDia: 0, porSemana: 0, porQuincena: 0, porMes: 0 };

  // Ritmo actual en unidad/día desde que empezó, y a ese ritmo, cuándo llega
  const ritmoActual = diasPasados > 0 && row.actual > 0 ? round2(row.actual / diasPasados) : null;
  let proyeccion = null;
  if (ritmoActual && ritmoActual > 0 && falta > 0) {
    const proyDias = Math.ceil(falta / ritmoActual);
    proyeccion = { dias: proyDias, fecha: addDaysISO(hoy, proyDias), aTiempo: proyDias <= diasLeft };
  }

  const salud = completada ? 'ok'
    : pct >= pctTiempo ? 'ok'
    : pct >= pctTiempo * 0.7 ? 'warn'
    : 'late';

  return {
    id: row.id,
    nombre: row.nombre,
    objetivo: row.objetivo,
    moneda: row.moneda,
    actual: row.actual,
    fechaLimite: row.fecha_limite,
    fechaInicio: row.fecha_inicio,
    icono: row.icono,
    color: row.color,
    activo: !!row.activo,
    completada,
    falta,
    pct,
    pctTiempo,
    diasTotal,
    diasLeft,
    diasPasados,
    cadencia,
    ritmoActual,
    proyeccion,
    salud
  };
}

router.get('/', (req, res) => {
  res.json(listStmt.all(req.user.id).map(serializeGoal));
});

// KPIs agregados en equivalente RD$ (una meta puede estar en USD$)
router.get('/resumen', (req, res) => {
  const rate = getExchangeRate(req.user.id).rate;
  const goals = listStmt.all(req.user.id);
  const toRD = (row, val) => (row.moneda === 'USD$' ? val * rate : val);

  const totalObjetivoRD = round2(goals.reduce((a, g) => a + toRD(g, g.objetivo), 0));
  const totalAhorradoRD = round2(goals.reduce((a, g) => a + toRD(g, g.actual), 0));
  const metasCompletas = goals.filter((g) => g.actual >= g.objetivo).length;

  res.json({
    totalMetas: goals.length,
    totalObjetivoRD,
    totalAhorradoRD,
    totalFaltaRD: round2(Math.max(0, totalObjetivoRD - totalAhorradoRD)),
    pctAhorradoGlobal: totalObjetivoRD > 0 ? round2((totalAhorradoRD / totalObjetivoRD) * 100) : 0,
    metasCompletas
  });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

  const objetivo = Number(b.objetivo);
  if (!Number.isFinite(objetivo) || objetivo <= 0) return res.status(400).json({ error: 'objetivo debe ser mayor que 0' });

  const moneda = b.moneda === 'USD$' ? 'USD$' : 'RD$';
  const actualInput = b.actual !== undefined && b.actual !== '' ? Number(b.actual) : 0;
  if (!Number.isFinite(actualInput) || actualInput < 0) return res.status(400).json({ error: 'actual debe ser un número mayor o igual a 0' });

  const fechaLimite = b.fechaLimite;
  if (!isValidFechaSort(fechaLimite)) return res.status(400).json({ error: 'fechaLimite es requerida (yyyy-mm-dd)' });
  const fechaInicio = b.fechaInicio && isValidFechaSort(b.fechaInicio) ? b.fechaInicio : todayLocalISO();
  if (fechaLimite <= fechaInicio) return res.status(400).json({ error: 'La fecha límite debe ser posterior a la fecha de inicio' });

  const icono = b.icono ? String(b.icono).trim() : '🎯';
  const color = b.color ? String(b.color).trim() : '#7c6fef';
  const actual = round2(Math.min(actualInput, objetivo));

  const info = db.prepare(`
    INSERT INTO goals (user_id, nombre, objetivo, moneda, actual, fecha_limite, fecha_inicio, icono, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, nombre, objetivo, moneda, actual, fechaLimite, fechaInicio, icono, color);

  res.status(201).json(serializeGoal(findById.get(req.user.id, info.lastInsertRowid)));
});

// Historial real de abonos (transactions) + acumulado por mes (últimos 6)
router.get('/:id/abonos', (req, res) => {
  const goal = findById.get(req.user.id, Number(req.params.id));
  if (!goal) return res.status(404).json({ error: 'Meta no existe' });

  const abonos = db.prepare(`
    SELECT id, monto_num, fecha_sort FROM transactions
    WHERE user_id = ? AND goal_id = ? ORDER BY fecha_sort DESC, id DESC
  `).all(req.user.id, goal.id).map((r) => ({ id: r.id, monto: r.monto_num, fechaSort: r.fecha_sort }));

  const porMesAll = db.prepare(`
    SELECT substr(fecha_sort, 1, 7) AS mk, SUM(monto_num) AS total FROM transactions
    WHERE user_id = ? AND goal_id = ? GROUP BY mk ORDER BY mk
  `).all(req.user.id, goal.id).map((r) => ({ mes: r.mk, total: round2(r.total) }));

  res.json({ abonos, porMes: porMesAll.slice(-6) });
});

router.post('/:id/abonar', (req, res) => {
  const goal = findById.get(req.user.id, Number(req.params.id));
  if (!goal) return res.status(404).json({ error: 'Meta no existe' });
  if (goal.actual >= goal.objetivo) return res.status(400).json({ error: 'Esta meta ya está completada' });

  const monto = Number((req.body || {}).monto);
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'monto debe ser mayor que 0' });
  const fechaSort = (req.body || {}).fechaSort || todayLocalISO();
  if (!isValidFechaSort(fechaSort)) return res.status(400).json({ error: 'fechaSort inválido (yyyy-mm-dd)' });

  // Un abono es un gasto real: reservar dinero para la meta reduce el
  // disponible del mes (igual que cualquier otro gasto — categoría Ahorro).
  const abonar = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (user_id, nombre, cat, metodo, monto_num, moneda, neg,
                                fecha_sort, quincena, tags, icon, goal_id)
      VALUES (?, ?, 'Ahorro', 'Transferencia', ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(req.user.id, `Abono meta: ${goal.nombre}`, monto, goal.moneda,
      fechaSort, quincenaOf(fechaSort), JSON.stringify(['meta', 'ahorro']), goal.icono, goal.id);

    const nuevoActual = round2(Math.min(goal.objetivo, goal.actual + monto));
    db.prepare('UPDATE goals SET actual = ? WHERE user_id = ? AND id = ?').run(nuevoActual, req.user.id, goal.id);
  });
  abonar();

  res.status(201).json({ ok: true, goal: serializeGoal(findById.get(req.user.id, goal.id)) });
});

router.put('/:id', (req, res) => {
  const goal = findById.get(req.user.id, Number(req.params.id));
  if (!goal) return res.status(404).json({ error: 'Meta no existe' });
  const b = req.body || {};

  const nombre = b.nombre !== undefined ? String(b.nombre).trim() : goal.nombre;
  if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

  let objetivo = goal.objetivo;
  if (b.objetivo !== undefined) {
    objetivo = Number(b.objetivo);
    if (!Number.isFinite(objetivo) || objetivo <= 0) return res.status(400).json({ error: 'objetivo debe ser mayor que 0' });
  }

  let fechaLimite = b.fechaLimite !== undefined ? b.fechaLimite : goal.fecha_limite;
  if (!isValidFechaSort(fechaLimite)) return res.status(400).json({ error: 'fechaLimite inválida (yyyy-mm-dd)' });
  let fechaInicio = b.fechaInicio !== undefined ? b.fechaInicio : goal.fecha_inicio;
  if (!isValidFechaSort(fechaInicio)) return res.status(400).json({ error: 'fechaInicio inválida (yyyy-mm-dd)' });
  if (fechaLimite <= fechaInicio) return res.status(400).json({ error: 'La fecha límite debe ser posterior a la fecha de inicio' });

  const icono = b.icono !== undefined ? (String(b.icono).trim() || '🎯') : goal.icono;
  const color = b.color !== undefined ? (String(b.color).trim() || '#7c6fef') : goal.color;
  const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : goal.activo;

  // El monto ahorrado no se edita directamente aquí (solo vía /abonar);
  // si el objetivo baja por debajo de lo ya ahorrado, se clampea.
  const actual = round2(Math.min(goal.actual, objetivo));

  db.prepare(`
    UPDATE goals SET nombre=?, objetivo=?, actual=?, fecha_limite=?, fecha_inicio=?, icono=?, color=?, activo=?
    WHERE user_id=? AND id=?
  `).run(nombre, objetivo, actual, fechaLimite, fechaInicio, icono, color, activo, req.user.id, goal.id);

  res.json(serializeGoal(findById.get(req.user.id, goal.id)));
});

router.delete('/:id', (req, res) => {
  const goal = findById.get(req.user.id, Number(req.params.id));
  if (!goal) return res.status(404).json({ error: 'Meta no existe' });
  const remove = db.transaction(() => {
    // Los abonos se conservan como gastos históricos normales (editables);
    // sin esto quedarían bloqueados para siempre por el guard de goal_id
    db.prepare('UPDATE transactions SET goal_id = NULL WHERE user_id = ? AND goal_id = ?')
      .run(req.user.id, goal.id);
    db.prepare('DELETE FROM goals WHERE user_id = ? AND id = ?').run(req.user.id, goal.id);
  });
  remove();
  res.json({ ok: true });
});

module.exports = router;
