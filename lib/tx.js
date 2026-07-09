const db = require('../db/database');

// Cláusulas compartidas por dashboard, budgets y listados.
// Los pagos de tarjeta son transferencias (neg=0, is_pago_tarjeta=1):
// NUNCA cuentan como gasto ni como ingreso.
const GASTO_CLAUSE = 'neg = 1 AND is_pago_tarjeta = 0';
const INGRESO_CLAUSE = 'neg = 0 AND is_pago_tarjeta = 0';

// Expresión SQL que convierte el monto a RD$ usando la tasa (parámetro ?)
const MONTO_RD_EXPR = "CASE WHEN moneda = 'USD$' THEN monto_num * ? ELSE monto_num END";

function rowToTx(row) {
  let tags = [];
  try {
    tags = JSON.parse(row.tags || '[]');
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    nombre: row.nombre,
    cat: row.cat,
    metodo: row.metodo,
    montoNum: row.monto_num,
    moneda: row.moneda,
    neg: !!row.neg,
    isPagoTarjeta: !!row.is_pago_tarjeta,
    isPagoPrestamo: !!row.is_pago_prestamo,
    fechaSort: row.fecha_sort,
    quincena: row.quincena,
    fuente: row.fuente,
    cuenta: row.cuenta,
    tags,
    icon: row.icon,
    iconBg: row.icon_bg,
    ccKey: row.cc_key,
    ccIsUsd: !!row.cc_is_usd,
    loanId: row.loan_id,
    installmentId: row.installment_id,
    fixedExpenseId: row.fixed_expense_id,
    fixedIncomeId: row.fixed_income_id,
    createdAt: row.created_at
  };
}

const bumpUsed = db.prepare(`
  UPDATE credit_cards SET used_rd = used_rd + ?, used_usd = used_usd + ?
  WHERE user_id = ? AND key = ?
`);

// Efecto de una transacción sobre el saldo usado de su tarjeta.
// sign=+1 al crearla, sign=-1 al revertirla (edición/borrado).
// Consumo (neg=1) sube el usado; pago de tarjeta lo baja.
function applyCardEffect(userId, txRow, sign) {
  if (!txRow.cc_key) return;
  let delta = 0;
  if (txRow.is_pago_tarjeta) delta = -sign * txRow.monto_num;
  else if (txRow.neg) delta = sign * txRow.monto_num;
  else return;
  if (txRow.cc_is_usd) bumpUsed.run(0, delta, userId, txRow.cc_key);
  else bumpUsed.run(delta, 0, userId, txRow.cc_key);
}

module.exports = { GASTO_CLAUSE, INGRESO_CLAUSE, MONTO_RD_EXPR, rowToTx, applyCardEffect };
