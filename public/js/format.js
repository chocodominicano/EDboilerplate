// Localización RD: montos siempre en formato 1,234.56 (2 decimales);
// fechas DD/MM en pantalla; aritmética de fechas por string
// (nunca Date+ISO, RD es UTC-4).

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtRD(n) {
  const v = Number(n) || 0;
  return v < 0 ? `−RD$${fmt2.format(-v)}` : `RD$${fmt2.format(v)}`;
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

// Suma n meses a una fecha 'yyyy-mm-dd' clampeando el día en meses cortos
// (31 ene + 1 mes → 28/29 feb), igual que hace el backend
export function addMonthsISO(iso, n) {
  const key = addMonthsToKey(iso.slice(0, 7), n);
  const d = Number(iso.slice(8, 10));
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const dim = new Date(y, m, 0).getDate();
  return `${key}-${pad2(Math.min(d, dim))}`;
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function monthLabel(key) {
  return `${MESES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}
