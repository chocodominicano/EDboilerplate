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

function quincenaOfDay(day) {
  return day >= 16 ? 2 : 1;
}

function quincenaOf(fechaSort) {
  return quincenaOfDay(Number(fechaSort.slice(8, 10)));
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

// Días de calendario entre dos 'yyyy-mm-dd' (toISO - fromISO). Usa
// Date.UTC solo para contar días completos (mediodía UTC fijo implícito
// en year/month/day) — nunca para formatear ni construir fechas locales,
// así que es seguro pese a la regla general de no usar Date+ISO.
function daysBetween(fromISO, toISO) {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// Suma n días de calendario a 'yyyy-mm-dd' (mismo uso de Date.UTC que
// daysBetween: solo para contar días, nunca para formatear/mostrar).
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
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
  quincenaOfDay,
  addMonthsToKey,
  dateInMonth,
  nextOccurrence,
  daysBetween,
  addDaysISO
};
