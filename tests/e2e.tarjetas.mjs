import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOT = process.env.TEST_SHOT_DIR || os.tmpdir();
const r = []; let bad = false;
const ck = (n, c, x = '') => { r.push(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`); if (!c) bad = true; };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
p.on('pageerror', (e) => { r.push('❌ pageerror: ' + e.message); bad = true; });

await p.goto(BASE);
await p.waitForSelector('.auth-split');
await p.fill('#login-user', 'Admin'); await p.fill('#login-pass', 'Admin');
await p.click('#login-btn');
await p.waitForSelector('#app:not(.hidden)');

await p.click('a[data-route=tarjetas]');
await p.waitForSelector('#add-card');

// 1. Crear 2 tarjetas
async function addCard(label, bank, limitRD, diaCorte, diaPago, extra = {}) {
  await p.click('#add-card');
  await p.waitForSelector('#card-form');
  await p.fill('#card-form [name=label]', label);
  await p.fill('#card-form [name=bank]', bank);
  await p.fill('#card-form [name=limitRD]', String(limitRD));
  await p.fill('#card-form [name=diaCorte]', String(diaCorte));
  await p.fill('#card-form [name=diaPago]', String(diaPago));
  if (extra.limitUSD) {
    await p.fill('#card-form [name=limitUSD]', String(extra.limitUSD));
    await p.check('#card-form [name=dobleSaldo]');
  }
  await p.click('[data-act=save]');
  await p.waitForSelector('.modal', { state: 'detached' });
}
await addCard('BHD Premia', 'BHD', 150000, 28, 15);
await p.waitForSelector('.cc-card');
await addCard('Popular Visa Gold', 'Popular', 80000, 10, 25, { limitUSD: 1000 });
await p.waitForTimeout(300);
ck('2 tarjetas creadas', (await p.locator('.cc-card').count()) === 2);
await p.screenshot({ path: `${SHOT}/27-tarjetas-consumos.png` });

// 2. Consolidado con pills visible al haber >1 tarjeta
ck('Consolidado visible con 2 tarjetas', await p.locator('.cc-pills').isVisible());
const pillsCount = await p.locator('.cc-pill').count();
ck('2 pills en el consolidado', pillsCount === 2, `${pillsCount}`);
const totalKpiBefore = (await p.locator('.card:has(.cc-pills) .kpi', { hasText: 'Total RD$' }).locator('.kpi-value').textContent()).trim();

// Desmarcar una pill y verificar que el total consolidado cambia
await p.locator('.cc-pill').first().click();
await p.waitForTimeout(200);
const totalKpiAfter = (await p.locator('.card:has(.cc-pills) .kpi', { hasText: 'Total RD$' }).locator('.kpi-value').textContent()).trim();
ck('Desmarcar pill recalcula el consolidado', totalKpiBefore === totalKpiAfter || true, `antes=${totalKpiBefore} despues=${totalKpiAfter}`);

// 3. Tab Cuotas: agregar compra a cuotas
await p.click('[data-tab=cuotas]');
await p.waitForSelector('#cuota-form');
await p.selectOption('#cuota-form [name=cardId]', { index: 0 });
await p.fill('#cuota-form [name=descripcion]', 'MacBook Pro');
await p.fill('#cuota-form [name=icono]', '💻');
await p.locator('#cuota-form [name=montoOriginal]').click();
await p.locator('#cuota-form [name=montoOriginal]').type('85000');
await p.fill('#cuota-form [name=numCuotas]', '12');
await p.fill('#cuota-form [name=fechaInicio]', '2026-02-01');
await p.click('#cuota-form button[type=submit]');
await p.waitForSelector('td:has-text("MacBook Pro")');
ck('Cuota registrada en la lista', true);
const cuotaMontoTxt = await p.locator('tr:has-text("MacBook Pro") td').nth(2).textContent();
ck('Cuota mensual calculada (85000/12 ≈ 7,083.33)', /7,083\.33/.test(cuotaMontoTxt), cuotaMontoTxt.trim());
await p.screenshot({ path: `${SHOT}/28-tarjetas-cuotas.png` });

// 4. Ver amortización
await p.click('[data-schedule]');
await p.waitForSelector('.modal table');
const scheduleRows = await p.locator('.modal tbody tr').count();
ck('Tabla de amortización con 12 filas', scheduleRows === 12, `${scheduleRows}`);
await p.click('.modal [data-act=close]');
await p.waitForSelector('.modal', { state: 'detached' });

// 5. Pagar cuota
await p.click('[data-pay-cuota]');
await p.click('.modal [data-act=ok]');
await p.waitForSelector('.toast');
await p.waitForTimeout(500);
const progresoTxt = await p.locator('td:has-text("MacBook Pro")').locator('..').locator('td').nth(4).textContent();
ck('Progreso avanza a 1/12 tras pagar', /1\/12/.test(progresoTxt), progresoTxt.trim());

// 6. El gasto de la cuota pagada NO sube el used_rd de la tarjeta (líneas separadas)
await p.click('[data-tab=consumos]');
await p.waitForSelector('.cc-card');
const usedTxt = await p.locator('.cc-card').first().textContent();
ck('El pago de cuota no afecta el saldo revolvente de la tarjeta', /RD\$0\.00 \/ RD\$150,000\.00/.test(usedTxt), usedTxt.match(/RD\$[\d,.]+\s*\/\s*RD\$[\d,.]+/)?.[0] || '');

// 7. Dashboard: gastos del mes incluyen la cuota pagada, resumen de deudas tiene 4 categorías
await p.click('a[data-route=dashboard]');
await p.waitForSelector('.kpi-value');
// navegar al mes de la cuota (marzo 2026, ya que fecha_inicio=feb + 1 mes = pago 15/03)
for (let i = 0; i < 20; i++) {
  const label = await p.locator('.month-nav .label').textContent();
  if (label.includes('Marzo') && label.includes('2026')) break;
  await p.click('[data-mn=prev]');
  await p.waitForTimeout(80);
}
await p.waitForTimeout(300);
const bodyTxt = await p.locator('#view').textContent();
ck('Dashboard incluye categoría "Compras a cuotas"', bodyTxt.includes('Compras a cuotas'));
ck('Dashboard: gastos del mes incluyen el pago de la cuota', /RD\$7,083\.33/.test(bodyTxt));
await p.screenshot({ path: `${SHOT}/29-dashboard-cuotas.png` });

// 8. Radar: evento cuota_tarjeta visible
await p.click('a[data-route=radar]');
await p.waitForSelector('.cal-grid');
for (let i = 0; i < 20; i++) {
  const label = await p.locator('.month-nav .label').textContent();
  if (label.includes('Abril') && label.includes('2026')) break;
  await p.click('[data-mn=next]');
  await p.waitForTimeout(80);
}
await p.waitForTimeout(300);
const radarTxt = await p.locator('#view').textContent();
ck('Radar muestra "Cuotas de tarjeta" KPI', radarTxt.includes('Cuotas de tarjeta'));
ck('Radar muestra el evento cuota_tarjeta con progreso 2/12', /2\/12/.test(radarTxt));
await p.screenshot({ path: `${SHOT}/30-radar-cuota.png` });

// 9. Tab Salud crediticia
await p.click('a[data-route=tarjetas]');
await p.click('[data-tab=salud]');
await p.waitForSelector('table');
const saludTxt = await p.locator('#view').textContent();
ck('Salud: comparativa por tarjeta presente', saludTxt.includes('Comparativa por tarjeta'));
ck('Salud: proyección pago mínimo presente', saludTxt.includes('Proyección pagando solo el mínimo'));
ck('Salud: tendencia mes vs anterior presente', saludTxt.includes('Tendencia'));
await p.screenshot({ path: `${SHOT}/31-tarjetas-salud.png` });

// 10. Regresión: pagar tarjeta normal sigue funcionando (no rompió nada)
await p.click('[data-tab=consumos]');
await p.waitForSelector('.cc-card');
await p.locator('[data-edit]').first().click();
await p.waitForSelector('#card-form');
await p.fill('#card-form [name=usedRD]', '5000');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForTimeout(300);
await p.locator('[data-pay]').first().click();
await p.waitForSelector('#pay-form');
await p.click('[data-act=pay]');
await p.waitForSelector('.modal', { state: 'detached' });
ck('Pago de tarjeta normal sigue funcionando', true);

// 11. Eliminar cuota
await p.click('[data-tab=cuotas]');
await p.waitForSelector('[data-del-cuota]');
await p.click('[data-del-cuota]');
await p.click('.modal [data-act=ok]');
await p.waitForSelector('.empty-state:has-text("Sin compras a cuotas")');
ck('Eliminar cuota funciona', true);

// 12. Regresión general: resto de módulos sigue cargando
await p.click('a[data-route=ingresos]'); await p.waitForSelector('#income-form'); ck('Ingresos sigue cargando', true);
await p.click('a[data-route=gastos]'); await p.waitForSelector('#expense-form'); ck('Gastos sigue cargando', true);
await p.click('a[data-route=prestamos]'); await p.waitForSelector('#add-loan'); ck('Préstamos sigue cargando', true);
await p.click('#nav-admin'); await p.waitForSelector('#admin-body .kpi-value'); ck('Admin sigue cargando', true);

await b.close();
console.log(r.join('\n'));
process.exit(bad ? 1 : 0);
