// Amortización francesa (cuota fija mensual)

function round2(n) {
  return Math.round(n * 100) / 100;
}

function frenchPayment(principal, tasaAnual, plazoMeses) {
  const i = tasaAnual / 100 / 12;
  if (i === 0) return principal / plazoMeses;
  return (principal * i) / (1 - Math.pow(1 + i, -plazoMeses));
}

// La cuota se redondea a 2 decimales, así que tras la última cuota del
// plazo puede quedar un residuo de centavos (p. ej. RD$0.31 en un préstamo
// de 500k al 12%/60m). Un saldo post-pago menor o igual a este umbral se
// absorbe en esa cuota en vez de generar una cuota fantasma adicional.
const RESIDUO_SALDO = 1;

// Divide una cuota en interés y capital sobre el saldo actual.
// La última cuota liquida el saldo exacto (capital nunca excede el saldo)
// y absorbe el residuo de redondeo (≤ RESIDUO_SALDO).
function splitCuota(saldo, tasaAnual, cuota) {
  const i = tasaAnual / 100 / 12;
  const interes = saldo * i;
  let capital = cuota - interes;
  if (capital < 0) capital = 0;
  if (capital > saldo || saldo - capital <= RESIDUO_SALDO) capital = saldo;
  return { interes: round2(interes), capital: round2(capital) };
}

module.exports = { frenchPayment, splitCuota, round2, RESIDUO_SALDO };
