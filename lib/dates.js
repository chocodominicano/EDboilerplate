// Toda la aritmética de fechas se hace con strings 'yyyy-mm-dd' y números,
// nunca con Date+toISOString: RD es UTC-4 y el ISO en UTC corre el día.

const FECHA_SORT_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function todayLocalISO() {
  const now = new Date();
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function currentMonthKey() {
  return todayLocalISO().slice(0, 7);
}

function daysInMonth(year, month) {
  // month 1-12; Date(y, m, 0) da el último día del mes m
  return new Date(year, month, 0).getDate();
}

function clampDay(day, year, month) {
  return Math.min(day, daysInMonth(year, month));
}

function isValidFechaSort(s) {
  if (typeof s !== 'string' || !FECHA_SORT_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function isValidMonthKey(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12;
}

function monthKey(fechaSort) {
  return fechaSort.slice(0, 7);
}

function quincenaOf(fechaSort) {
  return Number(fechaSort.slice(8, 10)) >= 16 ? 2 : 1;
}

// Suma n meses a un monthKey 'yyyy-mm' → 'yyyy-mm'
function addMonthsToKey(key, n) {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad2(nm)}`;
}

// Fecha 'yyyy-mm-dd' resultante de tomar el mes de `key` y un día clampeado
function dateInMonth(key, day) {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return ymd(y, m, clampDay(day, y, m));
}

// Próxima ocurrencia (>= hoy) de un día del mes, clampeado en meses cortos
function nextOccurrence(day, fromISO) {
  const from = fromISO || todayLocalISO();
  const key = monthKey(from);
  const candidate = dateInMonth(key, day);
  if (candidate >= from) return candidate;
  return dateInMonth(addMonthsToKey(key, 1), day);
}

module.exports = {
  FECHA_SORT_RE,
  pad2,
  ymd,
  todayLocalISO,
  currentMonthKey,
  daysInMonth,
  clampDay,
  isValidFechaSort,
  isValidMonthKey,
  monthKey,
  quincenaOf,
  addMonthsToKey,
  dateInMonth,
  nextOccurrence
};
