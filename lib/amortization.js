// Amortización francesa (cuota fija mensual)

function round2(n) {
  return Math.round(n * 100) / 100;
}

function frenchPayment(principal, tasaAnual, plazoMeses) {
  const i = tasaAnual / 100 / 12;
  if (i === 0) return principal / plazoMeses;
  return (principal * i) / (1 - Math.pow(1 + i, -plazoMeses));
}

// Divide una cuota en interés y capital sobre el saldo actual.
// La última cuota liquida el saldo exacto (capital nunca excede el saldo).
function splitCuota(saldo, tasaAnual, cuota) {
  const i = tasaAnual / 100 / 12;
  const interes = saldo * i;
  let capital = cuota - interes;
  if (capital < 0) capital = 0;
  if (capital > saldo) capital = saldo;
  return { interes: round2(interes), capital: round2(capital) };
}

module.exports = { frenchPayment, splitCuota, round2 };
