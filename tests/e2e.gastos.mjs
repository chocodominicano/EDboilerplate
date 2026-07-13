import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOT = process.env.TEST_SHOT_DIR || os.tmpdir();
const r = []; let bad = false;
const ck = (n, c, x = '') => { r.push(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`); if (!c) bad = true; };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
p.on('pageerror', (e) => { r.push('❌ pageerror: ' + e.message); bad = true; });

await p.goto(BASE);
await p.waitForSelector('.auth-split');
await p.fill('#login-user', 'Admin'); await p.fill('#login-pass', 'Admin');
await p.click('#login-btn');
await p.waitForSelector('#app:not(.hidden)');

// Setup: crear una tarjeta primero (para métodos, ciclo, USD warn)
await p.click('a[data-route=tarjetas]');
await p.waitForSelector('#add-card');
await p.click('#add-card');
await p.waitForSelector('#card-form');
await p.fill('#card-form [name=label]', 'BHD Premia');
await p.fill('#card-form [name=bank]', 'BHD');
await p.fill('#card-form [name=limitRD]', '150000');
await p.fill('#card-form [name=diaCorte]', '10');
await p.fill('#card-form [name=diaPago]', '25');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });

// Presupuesto para Comida (para el badge)
await p.click('a[data-route=presupuesto]');
await p.waitForSelector('#budget-form');
await p.selectOption('#budget-form [name=cat]', 'Comida');
await p.fill('#budget-form [name=monto]', '5000');
await p.click('#budget-form button[type=submit]');
await p.waitForSelector('td:has-text("Comida")');

await p.click('a[data-route=gastos]');
await p.waitForSelector('#expense-form');

// 1. KPIs presentes (3), inicialmente en 0
ck('3 KPIs de gastos', await p.locator('#view .kpis .kpi').count() === 3);
const totalKpi0 = (await p.locator('.kpi', { hasText: 'Total del mes' }).first().locator('.kpi-value').textContent()).trim();
ck('KPI total inicial en RD$0.00', totalKpi0 === 'RD$0.00', totalKpi0);

// 2. Registrar gasto en Comida con tarjeta (día 15, corte día 10 → debe avisar "próximo ciclo")
await p.fill('#expense-form [name=nombre]', 'Supermercado Nacional');
await p.locator('#expense-form [name=monto]').click();
await p.locator('#expense-form [name=monto]').type('4200');
await p.selectOption('#expense-form [name=cat]', 'Comida');
await p.selectOption('#expense-form [name=metodo]', 'cc:bhd-premia');
await p.fill('#expense-form [name=fechaSort]', new Date().toISOString().slice(0, 7) + '-15');
await p.fill('#expense-form [name=tags]', 'mercado, hogar');
await p.click('#expense-form button[type=submit]');
await p.waitForSelector('td:has-text("Supermercado Nacional")');
ck('Gasto registrado', true);
await p.screenshot({ path: `${SHOT}/33-gastos-mes.png` });

// 3. Badge de presupuesto visible (4200/5000 = 84%)
const rowTxt = await p.locator('tr:has-text("Supermercado Nacional")').textContent();
ck('Badge de presupuesto muestra 84%', /84% presup/.test(rowTxt), rowTxt.replace(/\s+/g, ' ').trim());

// 4. Aviso "próximo ciclo" (corte día 10, gasto día 15)
ck('Aviso "próximo ciclo" visible', rowTxt.includes('próximo ciclo'));

// 5. KPI total actualizado
const totalKpi1 = (await p.locator('.kpi', { hasText: 'Total del mes' }).first().locator('.kpi-value').textContent()).trim();
ck('KPI total = RD$4,200.00', totalKpi1 === 'RD$4,200.00', totalKpi1);

// 6. Modal de desglose por categoría al hacer clic en el KPI
await p.click('#kpi-total-mes');
await p.waitForSelector('.modal');
ck('Modal desglose muestra la categoría Comida', (await p.locator('.modal').textContent()).includes('Comida'));
await p.click('.modal [data-cat="Comida"]');
await p.waitForTimeout(300);
ck('Clic en categoría del modal activa el filtro', await p.locator('.filter-banner').isVisible());
await p.screenshot({ path: `${SHOT}/34-gastos-filtro-cat.png` });

// Quitar filtro
await p.click('[data-clear=cat]');
await p.waitForTimeout(300);
ck('Quitar filtro de categoría funciona', await p.locator('.filter-banner').count() === 0);

// 7. Filtro por tag (clic en chip de tag de la fila)
await p.locator('[data-tag="mercado"]').first().click();
await p.waitForTimeout(300);
ck('Filtro por tag activa el banner', (await p.locator('.filter-banner').textContent()).includes('mercado'));
await p.click('[data-clear=tag]');
await p.waitForTimeout(300);

// 8. Tag filter bar toggle
await p.click('#toggle-tag-bar');
await p.waitForTimeout(200);
ck('Barra de tags se despliega', await p.locator('#tag-filter-bar').isVisible());
await p.click('[data-settag="hogar"]');
await p.waitForTimeout(300);
ck('Clic en tag de la barra filtra', (await p.locator('.filter-banner').textContent()).includes('hogar'));
await p.click('[data-clear=tag]');
await p.waitForTimeout(200);

// 9. Registrar gasto en USD con tarjeta sin doble saldo → aviso
await p.selectOption('#expense-form [name=moneda]', 'USD$');
await p.selectOption('#expense-form [name=metodo]', 'cc:bhd-premia');
await p.waitForTimeout(200);
ck('Aviso USD sin doble saldo visible', await p.locator('#usd-warn').isVisible());
await p.selectOption('#expense-form [name=moneda]', 'RD$');
await p.waitForTimeout(200);
ck('Aviso desaparece al volver a RD$', await p.locator('#usd-warn').isHidden());

// 10. KPI USD$ (registrar un gasto real en USD con efectivo esta vez)
await p.selectOption('#expense-form [name=moneda]', 'USD$');
await p.selectOption('#expense-form [name=metodo]', 'Efectivo');
await p.fill('#expense-form [name=nombre]', 'Amazon compra');
await p.selectOption('#expense-form [name=cat]', 'Otros');
await p.locator('#expense-form [name=monto]').fill('');
await p.locator('#expense-form [name=monto]').type('49.99');
await p.click('#expense-form button[type=submit]');
await p.waitForSelector('td:has-text("Amazon compra")');
const usdKpi = (await p.locator('.kpi', { hasText: 'Gastos USD$' }).first().locator('.kpi-value').textContent()).trim();
ck('KPI USD$ = USD$49.99', usdKpi === 'USD$49.99', usdKpi);

await p.click('#kpi-usd');
await p.waitForSelector('.modal');
ck('Modal USD$ lista el gasto en Amazon', (await p.locator('.modal').textContent()).includes('Amazon'));
await p.click('.modal [data-act=close]');
await p.waitForSelector('.modal', { state: 'detached' });

// 11. Convertir a gasto fijo
await p.locator('[data-convert]').first().click();
await p.waitForSelector('#convert-form');
await p.click('.modal [data-act=save]');
await p.waitForTimeout(400);
ck('Convertir a gasto fijo funciona (sin error)', true);
await p.click('[data-tab=fijos]');
await p.waitForSelector('.badge-q1, .badge-q2');
ck('El gasto convertido aparece en Gastos fijos', (await p.locator('#view').textContent()).includes('Supermercado Nacional') || (await p.locator('#view').textContent()).includes('Amazon'));

// 12. Duplicado: intentar convertir el mismo de nuevo debe fallar amigablemente
await p.click('[data-tab=mes]');
await p.waitForSelector('[data-convert]');
await p.locator('[data-convert]').first().click();
await p.waitForTimeout(300);
ck('Segundo intento de convertir muestra aviso de duplicado (no abre modal)', (await p.locator('#convert-form').count()) === 0);
await p.screenshot({ path: `${SHOT}/35-gastos-convertir.png` });

// 13. Cargo bancario
await p.click('[data-formtab=cargo]');
await p.waitForSelector('#cargo-form');
await p.locator('#cargo-form [name=monto]').click();
await p.locator('#cargo-form [name=monto]').type('850');
await p.selectOption('#cargo-form [name=tipo]', 'mora');
await p.selectOption('#cargo-form [name=cardKey]', 'bhd-premia');
await p.click('#cargo-form button[type=submit]');
await p.waitForTimeout(500);
ck('Cargo bancario registrado (sin error)', true);

// Verificar que aparece en la tabla del mes con categoría Mora
await p.click('[data-formtab=consumo]');
await p.waitForSelector('#expense-form');
const mesTxt = await p.locator('#view').textContent();
ck('Cargo de mora aparece listado', mesTxt.includes('Mora') || mesTxt.includes('Cargo por mora'));

// 14. Verificar que el cargo con tarjeta sí subió el usedRD (interconexión con Tarjetas)
// Nota: el saldo acumula el gasto del súper (4200) + el cargo de mora (850) = 5050
await p.click('a[data-route=tarjetas]');
await p.waitForSelector('.cc-card');
const ccTxt = await p.locator('.cc-card').first().textContent();
ck('El cargo bancario subió el saldo de la tarjeta (interconexión)', /RD\$5,050\.00/.test(ccTxt), ccTxt.match(/RD\$[\d,.]+\s*\/\s*RD\$[\d,.]+/)?.[0] || '');

// 15. Dashboard: el total de gastos incluye todo lo registrado (interconexión)
await p.click('a[data-route=dashboard]');
await p.waitForSelector('.kpi-value');
const dashGastos = (await p.locator('.kpi', { hasText: 'Gastos' }).first().locator('.kpi-value').textContent()).trim();
// 4200 (super) + 49.99*60=2999.40 (amazon usd->rd) + 850 (mora) = 8049.40
ck('Dashboard suma correctamente gastos RD$+USD$ equivalente', dashGastos === 'RD$8,049.40', dashGastos);

// 16. Regresión: resto de módulos sigue cargando
await p.click('a[data-route=ingresos]'); await p.waitForSelector('#income-form'); ck('Ingresos sigue cargando', true);
await p.click('a[data-route=prestamos]'); await p.waitForSelector('#add-loan'); ck('Préstamos sigue cargando', true);
await p.click('a[data-route=radar]'); await p.waitForSelector('.cal-grid'); ck('Radar sigue cargando', true);
await p.click('#nav-admin'); await p.waitForSelector('#admin-body .kpi-value'); ck('Admin sigue cargando', true);

await b.close();
console.log(r.join('\n'));
process.exit(bad ? 1 : 0);
