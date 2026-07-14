import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const SHOT = process.env.TEST_SHOT_DIR || os.tmpdir();
const r = []; let bad = false;
const ck = (n, c, x = '') => { r.push(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`); if (!c) bad = true; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
p.on('pageerror', (e) => { r.push('❌ pageerror: ' + e.message); bad = true; });
p.on('console', (m) => { if (m.type() === 'error') { r.push('❌ console.error: ' + m.text()); bad = true; } });

await p.goto(BASE);
await p.waitForSelector('.auth-split');
await p.fill('#login-user', 'Admin');
await p.fill('#login-pass', 'Admin');
await p.click('#login-btn');
await p.waitForSelector('#app:not(.hidden)');

const mesActual = new Date().toISOString().slice(0, 7);

// ══ Seed: ingreso, gastos, presupuesto, préstamo con abono extra, meta, tarjeta con deuda alta, cuota ══
await p.click('a[data-route=ingresos]');
await p.waitForSelector('#income-form');
await p.fill('#income-form [name=mesAnio]', mesActual);
await p.fill('#income-form [name=fuente]', 'Trabajo');
await p.fill('#income-form [name=nombre]', 'Salario');
await p.locator('#income-form [name=monto]').click();
await p.locator('#income-form [name=monto]').type('50000');
await p.click('#income-form button[type=submit]');
await p.waitForTimeout(400);

await p.click('a[data-route=gastos]');
await p.waitForSelector('#expense-form');
await p.fill('#expense-form [name=nombre]', 'Compra semanal');
await p.locator('#expense-form [name=monto]').click();
await p.locator('#expense-form [name=monto]').type('8000');
await p.selectOption('#expense-form [name=cat]', 'Comida');
await p.selectOption('#expense-form [name=metodo]', 'Efectivo');
await p.fill('#expense-form [name=fechaSort]', `${mesActual}-03`);
await p.click('#expense-form button[type=submit]');
await p.waitForTimeout(300);
await p.fill('#expense-form [name=nombre]', 'Gasolina');
await p.locator('#expense-form [name=monto]').click();
await p.locator('#expense-form [name=monto]').type('2000');
await p.selectOption('#expense-form [name=cat]', 'Transporte');
await p.selectOption('#expense-form [name=metodo]', 'Transferencia');
await p.fill('#expense-form [name=fechaSort]', `${mesActual}-08`);
await p.click('#expense-form button[type=submit]');
await p.waitForTimeout(300);

await p.click('a[data-route=presupuesto]');
await p.waitForSelector('#budget-form');
await p.selectOption('#budget-form [name=cat]', 'Comida');
await p.locator('#budget-form [name=monto]').click();
await p.locator('#budget-form [name=monto]').type('10000');
await p.click('#budget-form button[type=submit]');
await p.waitForTimeout(300);

await p.click('a[data-route=prestamos]');
await p.waitForSelector('#add-loan');
await p.click('#add-loan');
await p.waitForSelector('#loan-form');
await p.fill('#loan-form [name=nombre]', 'Prestamo Reportes');
await p.fill('#loan-form [name=banco]', 'BHD');
await p.locator('#loan-form [name=original]').click();
await p.locator('#loan-form [name=original]').type('100000');
await p.fill('#loan-form [name=tasaAnual]', '12');
await p.fill('#loan-form [name=plazoMeses]', '24');
await p.fill('#loan-form [name=diaPago]', '20');
await p.fill('#loan-form [name=penalidadPct]', '3');
await p.fill('#loan-form [name=fecha]', '2026-01-01');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForSelector('#view table tbody tr');

await p.click('[data-pay="1"]');
await p.waitForSelector('.modal');
await p.locator('.modal button', { hasText: 'Pagar cuota' }).click();
await p.waitForSelector('#view table tbody tr');
await p.waitForTimeout(300);

await p.click('[data-extra="1"]');
await p.waitForSelector('#extra-form');
await p.locator('#extra-form [name=monto]').click();
await p.locator('#extra-form [name=monto]').type('10000');
await p.waitForSelector('#extra-sim table', { timeout: 5000 });
await p.click('[data-act=apply]');
await p.waitForSelector('.modal:last-of-type [data-act=ok]');
await p.click('.modal:last-of-type [data-act=ok]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForTimeout(400);

await p.click('a[data-route=metas]');
await p.waitForSelector('#add-goal');
await p.click('#add-goal');
await p.waitForSelector('#goal-form');
await p.fill('#goal-form [name=nombre]', 'Viaje');
await p.locator('#goal-form [name=objetivo]').click();
await p.locator('#goal-form [name=objetivo]').type('20000');
await p.fill('#goal-form [name=fechaLimite]', '2026-12-31');
await p.fill('#goal-form [name=fechaInicio]', '2026-01-01');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForTimeout(300);
const abonoInput = p.locator('[data-abono-input]').first();
await abonoInput.click();
await abonoInput.type('5000');
await p.locator('[data-abonar]').first().click();
await p.waitForTimeout(400);

await p.click('a[data-route=tarjetas]');
await p.waitForSelector('#add-card');
await p.click('#add-card');
await p.waitForSelector('#card-form');
await p.fill('#card-form [name=label]', 'Visa Riesgo');
const limitInput = p.locator('#card-form [name=limitRD]');
await limitInput.click(); await limitInput.press('Control+a'); await limitInput.type('10000');
const usedInput = p.locator('#card-form [name=usedRD]');
await usedInput.click(); await usedInput.press('Control+a'); await usedInput.type('9500');
await p.fill('#card-form [name=tasaInteres]', '60');
await p.fill('#card-form [name=pagoMinimoPct]', '2');
await p.fill('#card-form [name=diaCorte]', '10');
await p.fill('#card-form [name=diaPago]', '25');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForTimeout(300);

await p.click('[data-tab=cuotas]');
await p.waitForSelector('#cuota-form');
await p.selectOption('#cuota-form [name=cardId]', { index: 0 });
await p.fill('#cuota-form [name=descripcion]', 'Laptop');
await p.fill('#cuota-form [name=icono]', '💻');
await p.locator('#cuota-form [name=montoOriginal]').click();
await p.locator('#cuota-form [name=montoOriginal]').type('24000');
await p.fill('#cuota-form [name=numCuotas]', '12');
await p.fill('#cuota-form [name=fechaInicio]', '2026-06-01');
await p.click('#cuota-form button[type=submit]');
await p.waitForSelector('td:has-text("Laptop")');
await p.click('[data-pay-cuota]');
await p.click('.modal [data-act=ok]');
await p.waitForTimeout(400);

// ══ Reportes ══
await p.click('a[data-route=reportes]');
await p.waitForSelector('#rep-period');
ck('toolbar: selector de período presente', await p.locator('#rep-period').count() === 1);
ck('toolbar: botones de exportación presentes', await p.locator('#rep-export-pdf').count() === 1 && await p.locator('#rep-export-excel').count() === 1);
ck('tabs: 6 tabs presentes', await p.locator('[data-tab]').count() === 6);
ck('tab Mensual activa por defecto', await p.locator('[data-tab=mensual]').evaluate((el) => el.classList.contains('active')));

// Mensual
await p.waitForSelector('.kpis .kpi', { timeout: 5000 });
let txt = await p.locator('#rep-body').textContent();
ck('Mensual: asesor financiero presente', txt.includes('Asesor financiero'));
ck('Mensual: ingresos 50,000.00', txt.includes('50,000.00'));
ck('Mensual: top categorías presente', txt.includes('Top categorías de gasto') && txt.includes('Comida'));
ck('Mensual: gasto por método presente', txt.includes('Gasto por método de pago'));
ck('Mensual: presupuesto presente', txt.includes('Presupuesto vs gastado'));
ck('Mensual: préstamos con saldo', txt.includes('Total adeudado'));
ck('Mensual: tarjetas con deuda', txt.includes('9,500.00'));
await p.screenshot({ path: `${SHOT}/rep_1_mensual.png`, fullPage: true });

// Anual
await p.click('[data-tab=anual]');
await p.waitForSelector('#rep-year', { timeout: 5000 });
txt = await p.locator('#rep-body').textContent();
ck('Anual: KPIs presentes', txt.includes('Ingresos del año'));
ck('Anual: tabla mensual presente', txt.includes('Detalle mensual'));
await p.screenshot({ path: `${SHOT}/rep_2_anual.png`, fullPage: true });

// Proyección
await p.click('[data-tab=proyeccion]');
await p.waitForSelector('#proy-horizonte', { timeout: 5000 });
txt = await p.locator('#rep-body').textContent();
ck('Proyección: KPIs presentes', txt.includes('Balance acumulado'));
ck('Proyección: metas alcanzables presente', txt.includes('Metas alcanzables') && txt.includes('Viaje'));
await p.selectOption('#proy-escenario', 'pesimista');
await p.waitForTimeout(400);
ck('Proyección: escenario pesimista aplicado', (await p.locator('#rep-body').textContent()).includes('Pesimista'));
await p.screenshot({ path: `${SHOT}/rep_3_proyeccion.png`, fullPage: true });

// Pagos extra
await p.click('[data-tab=pagosextra]');
await p.waitForSelector('#pe-loan-filter', { timeout: 5000 });
txt = await p.locator('#rep-body').textContent();
ck('Pagos extra: abono a capital presente', txt.includes('Total abonado a capital'));
ck('Pagos extra: penalización 300.00', txt.includes('300.00'));
await p.screenshot({ path: `${SHOT}/rep_4_pagosextra.png`, fullPage: true });

// Cuotas
await p.click('[data-tab=cuotas]');
await p.waitForTimeout(400);
txt = await p.locator('#rep-body').textContent();
ck('Cuotas: compra Laptop listada', txt.includes('Laptop'));
ck('Cuotas: link a Tarjetas presente', await p.locator('#rep-ver-cuotas').count() === 1);
await p.screenshot({ path: `${SHOT}/rep_5_cuotas.png`, fullPage: true });

// Tarjetas
await p.click('[data-tab=tarjetas]');
await p.waitForSelector('table', { timeout: 5000 });
txt = await p.locator('#rep-body').textContent();
ck('Tarjetas: comparativa presente', txt.includes('Comparativa por tarjeta') && txt.includes('Visa Riesgo'));
ck('Tarjetas: tendencia presente', txt.includes('Tendencia'));
await p.screenshot({ path: `${SHOT}/rep_6_tarjetas.png`, fullPage: true });

await p.locator('#rep-ver-salud').click();
await p.waitForTimeout(400);
ck('botón "Ver salud crediticia" navega a Tarjetas', (await p.locator('h1').textContent()).includes('Tarjetas'));

// Exportación
await p.click('a[data-route=reportes]');
await p.waitForSelector('#rep-period');
const [dlPdf] = await Promise.all([
  p.waitForEvent('download', { timeout: 8000 }),
  p.click('#rep-export-pdf')
]);
ck('exportar PDF dispara descarga', dlPdf.suggestedFilename().endsWith('.pdf'), dlPdf.suggestedFilename());

const [dlXlsx] = await Promise.all([
  p.waitForEvent('download', { timeout: 8000 }),
  p.click('#rep-export-excel')
]);
ck('exportar Excel dispara descarga', dlXlsx.suggestedFilename().endsWith('.xlsx'), dlXlsx.suggestedFilename());

// ══ Regresión: resto de módulos siguen cargando ══
for (const route of ['dashboard', 'ingresos', 'gastos', 'tarjetas', 'prestamos', 'metas', 'presupuesto', 'radar', 'admin']) {
  await p.click(`a[data-route=${route}]`);
  await p.waitForTimeout(500);
  const has = await p.locator('#view > *').count();
  ck(`regresión: vista ${route} renderiza`, has > 0);
}

await b.close();
console.log(r.join('\n'));
console.log(`\n${r.filter((x) => x.startsWith('✅')).length} OK / ${r.filter((x) => x.startsWith('❌')).length} FAIL`);
process.exit(bad ? 1 : 0);
