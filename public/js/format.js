// Localización RD: RD$1,200 sin decimales; fechas DD/MM en pantalla;
// aritmética de fechas por string (nunca Date+ISO, RD es UTC-4).

const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtRD(n) {
  const v = Math.round(Number(n) || 0);
  return v < 0 ? `−RD$${fmt0.format(-v)}` : `RD$${fmt0.format(v)}`;
}

export function fmtUSD(n) {
  const v = Number(n) || 0;
  return v < 0 ? `−USD$${fmt2.format(-v)}` : `USD$${fmt2.format(v)}`;
}

export function fmtMoney(n, moneda) {
  return moneda === 'USD$' ? fmtUSD(n) : fmtRD(n);
}

export function fmtFechaDDMM(fechaSort) {
  if (!fechaSort || fechaSort.length < 10) return '';
  return `${fechaSort.slice(8, 10)}/${fechaSort.slice(5, 7)}`;
}

export function quincenaOf(fechaSort) {
  return Number(fechaSort.slice(8, 10)) >= 16 ? 2 : 1;
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function currentMonthKey() {
  return todayISO().slice(0, 7);
}

export function addMonthsToKey(key, n) {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function monthLabel(key) {
  return `${MESES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}
