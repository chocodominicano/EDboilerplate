// E2E: ajustes al crear un préstamo — cuota personalizada del banco,
// préstamo ya iniciado (cuotas pasadas SIN registrarse como gastos) y
// saldo ajustado al estado de cuenta.
import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOT = process.env.TEST_SHOT_DIR || os.tmpdir();

const results = [];
let failed = false;
const check = (n, c, x = '') => { results.push(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`); if (!c) failed = true; };

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
p.on('pageerror', (e) => { results.push(`❌ pageerror: ${e.message}`); failed = true; });

await p.goto(BASE);
await p.waitForSelector('.auth-split');
await p.fill('#login-user', 'Admin');
await p.fill('#login-pass', 'Admin');
await p.click('#login-btn');
await p.waitForSelector('#app:not(.hidden)');

// Fecha de inicio 14 meses atrás (día 15 para evitar líos de fin de mes)
const hoy = new Date();
const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 14, 15);
const inicioISO = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-15`;

// ── 1. Préstamo pre-existente con cuota y saldo del banco ──
await p.click('a[data-route=prestamos]');
await p.waitForSelector('#add-loan');
await p.click('#add-loan');
await p.waitForSelector('#loan-form');

await p.fill('#loan-form [name=nombre]', 'Vehículo pre-existente');
await p.fill('#loan-form [name=banco]', 'BHD');
await p.locator('#loan-form [name=original]').click();
await p.locator('#loan-form [name=original]').type('500000');
await p.fill('#loan-form [name=tasaAnual]', '12');
await p.fill('#loan-form [name=plazoMeses]', '60');
await p.fill('#loan-form [name=diaPago]', '15');

// La cuota se pre-llena con la teórica (11,122.22)
await p.waitForTimeout(200);
const cuotaAuto = await p.locator('#loan-form [name=cuotaMensual]').inputValue();
check('Cuota pre-llenada con el cálculo teórico (11,122.22)', cuotaAuto === '11,122.22', cuotaAuto);

// Ajustarla al valor "del banco"
const cuotaInput = p.locator('#loan-form [name=cuotaMensual]');
await cuotaInput.click();
await cuotaInput.press('Control+a');
await cuotaInput.type('11500');
await p.waitForTimeout(200);
const prevTxt = await p.locator('#loan-preview').textContent();
check('Preview muestra el plazo real con la cuota ajustada', /termina en \d+ cuotas/.test(prevTxt), prevTxt.trim().slice(0, 120));

// Fecha en el pasado → aparece la sección de préstamo ya iniciado
await p.fill('#loan-form [name=fecha]', inicioISO);
await p.waitForSelector('#loan-iniciado:not(.hidden)');
check('Sección "préstamo ya iniciado" aparece con fecha pasada', true);
const cuotasSugeridas = await p.locator('#loan-form [name=cuotasPagadas]').inputValue();
check('Cuotas pagadas sugeridas = 14 (meses transcurridos)', cuotasSugeridas === '14', cuotasSugeridas);
const saldoSimulado = await p.locator('#loan-form [name=saldoActual]').inputValue();
check('Saldo pre-llenado con la simulación', /^\d{3},\d{3}\.\d{2}$/.test(saldoSimulado), saldoSimulado);

// Ajustar el saldo al valor exacto del estado de cuenta
const saldoInput = p.locator('#loan-form [name=saldoActual]');
await saldoInput.click();
await saldoInput.press('Control+a');
await saldoInput.type('410000');
await p.screenshot({ path: `${SHOT}/32-prestamo-ajustado-form.png` });

await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForSelector('tr:has-text("Vehículo pre-existente")');
const filaTxt = await p.locator('tr:has-text("Vehículo pre-existente")').textContent();
check('Cuota guardada = RD$11,500.00', filaTxt.includes('RD$11,500.00'));
check('Saldo guardado = RD$410,000.00 (ajustado al banco)', filaTxt.includes('RD$410,000.00'));
check('Progreso 18% amortizado', filaTxt.includes('18%'), filaTxt.match(/\d+% amortizado/)?.[0] || '');
await p.screenshot({ path: `${SHOT}/33-prestamo-ajustado-lista.png` });

// ── 2. Las cuotas pasadas NO son gastos ────────────────────
await p.click('a[data-route=gastos]');
await p.waitForSelector('.kpi-value');
const gastosKpi = (await p.locator('.kpi-value').first().textContent()).trim();
check('Gastos del mes = RD$0.00 (las 14 cuotas previas no son gastos)', gastosKpi === 'RD$0.00', gastosKpi);

await p.click('a[data-route=dashboard]');
// esperar contenido exclusivo del dashboard (.kpi-value también existe en Gastos)
await p.waitForSelector('h2:has-text("Resumen de todas mis deudas")');
const dashTxt = await p.locator('#view').textContent();
check('Dashboard: deuda de préstamos = RD$410,000.00', dashTxt.includes('RD$410,000.00'));
check('Dashboard: 0 transacciones este mes', /Transacciones\s*0/.test(dashTxt.replace(/\n/g, ' ')));

// ── 3. La próxima cuota SÍ se registra como gasto ──────────
await p.click('a[data-route=prestamos]');
await p.waitForSelector('[data-pay]');
await p.click('[data-pay]');
await p.waitForSelector('.modal [data-act=ok]');
await p.click('.modal [data-act=ok]');
await p.waitForSelector('.toast:has-text("Cuota pagada")');
const toastTxt = await p.locator('.toast').last().textContent();
check('Pago separa interés RD$4,100 + capital RD$7,400 sobre el saldo ajustado',
  toastTxt.includes('RD$4,100.00') && toastTxt.includes('RD$7,400.00'), toastTxt.trim());

await p.click('a[data-route=gastos]');
await p.waitForSelector('.kpi-value');
await p.waitForTimeout(300);
const gastosKpi2 = (await p.locator('.kpi-value').first().textContent()).trim();
check('El pago de la cuota actual sí es un gasto del mes (RD$11,500.00)', gastosKpi2 === 'RD$11,500.00', gastosKpi2);

// ── 4. Cuota que no amortiza se rechaza ────────────────────
await p.click('a[data-route=prestamos]');
await p.waitForSelector('#add-loan');
await p.click('#add-loan');
await p.waitForSelector('#loan-form');
await p.fill('#loan-form [name=nombre]', 'Préstamo imposible');
await p.locator('#loan-form [name=original]').click();
await p.locator('#loan-form [name=original]').type('500000');
await p.fill('#loan-form [name=tasaAnual]', '12');
await p.fill('#loan-form [name=plazoMeses]', '60');
await p.fill('#loan-form [name=diaPago]', '15');
await p.waitForTimeout(200);
const cuotaBaja = p.locator('#loan-form [name=cuotaMensual]');
await cuotaBaja.click();
await cuotaBaja.press('Control+a');
await cuotaBaja.type('4000');
await p.waitForTimeout(200);
const prevBaja = await p.locator('#loan-preview').textContent();
check('Preview avisa que la cuota no cubre el interés', prevBaja.includes('no cubre el interés'));
await p.click('[data-act=save]');
await p.waitForSelector('.toast:has-text("no cubre el interés")');
check('El backend rechaza la cuota que no amortiza', true);
await p.click('.modal [data-act=cancel]');
await p.waitForSelector('.modal', { state: 'detached' });

// ── 5. Regresión: préstamo nuevo sin ajustes sigue igual ───
await p.click('#add-loan');
await p.waitForSelector('#loan-form');
await p.fill('#loan-form [name=nombre]', 'Préstamo normal');
await p.locator('#loan-form [name=original]').click();
await p.locator('#loan-form [name=original]').type('100000');
await p.fill('#loan-form [name=tasaAnual]', '10');
await p.fill('#loan-form [name=plazoMeses]', '24');
await p.fill('#loan-form [name=diaPago]', '5');
await p.waitForTimeout(200);
check('Sección "ya iniciado" oculta con fecha de hoy',
  await p.locator('#loan-iniciado').evaluate((el) => el.classList.contains('hidden')));
await p.click('[data-act=save]');
await p.waitForSelector('tr:has-text("Préstamo normal")');
const filaNormal = await p.locator('tr:has-text("Préstamo normal")').textContent();
check('Préstamo normal usa la cuota teórica (RD$4,614.49)', filaNormal.includes('RD$4,614.49'), filaNormal.match(/RD\$[\d,.]+/)?.[0] || '');
check('Préstamo normal arranca con 0% amortizado', filaNormal.includes('0%'));

// ── 6. Regresión: otras vistas siguen cargando ─────────────
await p.click('a[data-route=dashboard]'); await p.waitForSelector('.kpi-value'); check('Dashboard sigue cargando', true);
await p.click('a[data-route=radar]'); await p.waitForSelector('.radar-toolbar'); check('Radar sigue cargando', true);
await p.click('a[data-route=reportes]'); await p.waitForSelector('.tabs'); check('Reportes sigue cargando', true);

await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('✅')).length} OK / ${results.filter((r) => r.startsWith('❌')).length} FAIL`);
process.exit(failed ? 1 : 0);
