const { daysInMonth, clampDay, ymd, monthKey, addMonthsToKey } = require('./dates');

// Ciclo de corte vigente de una tarjeta respecto a una fecha de referencia.
// Si el día de ref ya pasó el corte de este mes, el ciclo corre del día
// siguiente al corte de este mes hasta el corte del próximo; si no, del
// día siguiente al corte del mes anterior hasta el corte de este mes.
// El día de corte se clampea en meses cortos (corte 31 en febrero → 28/29).
function cycleRange(diaCorte, refISO) {
  const y = Number(refISO.slice(0, 4));
  const m = Number(refISO.slice(5, 7));
  const d = Number(refISO.slice(8, 10));

  const corteEsteMes = clampDay(diaCorte, y, m);
  const endKey = d > corteEsteMes ? addMonthsToKey(monthKey(refISO), 1) : monthKey(refISO);

  const ey = Number(endKey.slice(0, 4));
  const em = Number(endKey.slice(5, 7));
  const end = ymd(ey, em, clampDay(diaCorte, ey, em));

  const startKey = addMonthsToKey(endKey, -1);
  const sy = Number(startKey.slice(0, 4));
  const sm = Number(startKey.slice(5, 7));
  const prevCorte = clampDay(diaCorte, sy, sm);

  const start = prevCorte < daysInMonth(sy, sm)
    ? ymd(sy, sm, prevCorte + 1)
    : ymd(ey, em, 1);

  return { start, end };
}

module.exports = { cycleRange };
