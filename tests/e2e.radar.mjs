import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || BASE;

const SHOT = process.env.TEST_SHOT_DIR || os.tmpdir();
const r = []; let bad = false;
const ck = (n, c, x = '') => { r.push(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`); if (!c) bad = true; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on('pageerror', (e) => { r.push('❌ pageerror: ' + e.message); bad = true; });

await p.goto(BASE);
await p.waitForSelector('.auth-split');
await p.fill('#login-user', 'Admin');
await p.fill('#login-pass', 'Admin');
await p.click('#login-btn');
await p.waitForSelector('#app:not(.hidden)');

// ══ Seed: tarjeta con deuda, gasto fijo, ingreso fijo, préstamo ══
await p.click('a[data-route=tarjetas]');
await p.waitForSelector('#add-card');
await p.click('#add-card');
await p.waitForSelector('#card-form');
await p.fill('#card-form [name=label]', 'Visa BHD');
const limitInput = p.locator('#card-form [name=limitRD]');
await limitInput.click(); await limitInput.press('Control+a'); await limitInput.type('50000');
const usedInput = p.locator('#card-form [name=usedRD]');
await usedInput.click(); await usedInput.press('Control+a'); await usedInput.type('20000');
await p.fill('#card-form [name=tasaInteres]', '48');
await p.fill('#card-form [name=diaCorte]', '10');
await p.fill('#card-form [name=diaPago]', '25');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });

await p.click('a[data-route=gastos]');
await p.waitForSelector('[data-tab=fijos]');
await p.click('[data-tab=fijos]');
await p.waitForSelector('#fixed-exp-form');
await p.fill('#fixed-exp-form [name=concepto]', 'Internet');
const montoFijo = p.locator('#fixed-exp-form [name=monto]');
await montoFijo.click(); await montoFijo.type('2500');
await p.fill('#fixed-exp-form [name=dia]', '15');
await p.locator('#fixed-exp-form button[type=submit]').click();
await p.waitForTimeout(400);

await p.click('a[data-route=ingresos]');
await p.waitForSelector('#fixed-income-form');
await p.fill('#fixed-income-form [name=descripcion]', 'Salario');
const montoIng = p.locator('#fixed-income-form [name=monto]');
await montoIng.click(); await montoIng.type('40000');
await p.fill('#fixed-income-form [name=dia]', '5');
await p.locator('#fixed-income-form button[type=submit]').click();
await p.waitForTimeout(400);

await p.click('a[data-route=prestamos]');
await p.waitForSelector('#add-loan');
await p.click('#add-loan');
await p.waitForSelector('#loan-form');
await p.fill('#loan-form [name=nombre]', 'Préstamo Auto');
const montoPrestamo = p.locator('#loan-form [name=original]');
await montoPrestamo.click(); await montoPrestamo.type('100000');
await p.fill('#loan-form [name=tasaAnual]', '12');
await p.fill('#loan-form [name=plazoMeses]', '24');
await p.fill('#loan-form [name=diaPago]', '20');
await p.fill('#loan-form [name=fecha]', '2026-01-01');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });

// ══ Radar: vista Mes ══
await p.click('a[data-route=radar]');
await p.waitForSelector('.radar-toolbar');
ck('toolbar: 3 tabs presentes', await p.locator('[data-view]').count() === 3);
ck('vista Mes activa por defecto', await p.locator('[data-view=mes]').evaluate((el) => el.classList.contains('active')));

// navegar al mes de julio 2026 si no estamos ahí ya (usamos prev/next para llegar)
// primero verificamos el título del mes actual
const tituloMes = await p.locator('.radar-title').textContent();
ck('título de mes visible', tituloMes.trim().length > 0, tituloMes.trim());

await p.waitForSelector('.cal-grid .cal-event', { timeout: 5000 });
const eventCount = await p.locator('.cal-grid .cal-event').count();
ck('vista Mes: eventos visibles en el calendario', eventCount >= 4, `count=${eventCount}`);
ck('vista Mes: evento de corte con estilo distinto (dashed)', await p.locator('.cal-event.corte_tarjeta').count() === 1);
ck('vista Mes: evento de pago tarjeta presente', await p.locator('.cal-event.pago_tarjeta').count() === 1);
await p.screenshot({ path: `${SHOT}/radar_1_mes.png`, fullPage: true });

// ══ Popover al hacer clic en un evento ══
await p.locator('.cal-event.gasto_fijo').first().click();
await p.waitForSelector('.modal', { timeout: 3000 });
const popTxt = await p.locator('.modal').textContent();
ck('popover: muestra tipo "Gasto fijo"', popTxt.includes('Gasto fijo'));
ck('popover: muestra monto', popTxt.includes('2,500.00'));
ck('popover: botón "Ir a Gastos"', popTxt.includes('Ir a Gastos'));
await p.waitForTimeout(300);
await p.screenshot({ path: `${SHOT}/radar_2_popover.png` });
await p.locator('.modal button', { hasText: 'Ir a Gastos' }).click();
await p.waitForTimeout(400);
ck('popover: navega correctamente a Gastos', (await p.locator('h1').textContent()).includes('Gastos'));

// ══ Volver al radar y probar popover de ingreso (marcar recibido) ══
await p.click('a[data-route=radar]');
await p.waitForSelector('.cal-event.ingreso_fijo');
await p.locator('.cal-event.ingreso_fijo').first().click();
await p.waitForSelector('.modal');
const popTxt2 = await p.locator('.modal').textContent();
ck('popover ingreso: botón "Marcar como recibido" presente', popTxt2.includes('Marcar como recibido'));
await p.locator('.modal button', { hasText: 'Marcar como recibido' }).click();
await p.waitForSelector('.modal');
await p.locator('.modal button', { hasText: 'Marcar recibido' }).click();
await p.waitForTimeout(500);
const ingresoTxt = await p.locator('.cal-event.ingreso_fijo').first().textContent();
ck('ingreso: ícono cambia a ✅ tras marcar recibido', ingresoTxt.includes('✅'));

// ══ Vista Semana ══
await p.click('[data-view=semana]');
await p.waitForSelector('.rweek-grid', { timeout: 3000 });
ck('vista Semana: 7 columnas', await p.locator('.rweek-col').count() === 7);
ck('vista Semana: columna hoy resaltada', await p.locator('.rweek-col.today').count() === 1);
await p.screenshot({ path: `${SHOT}/radar_3_semana.png`, fullPage: true });

// ══ Vista Hoy (agenda) ══
await p.click('[data-view=hoy]');
await p.waitForSelector('#radar-body .ragenda, #radar-body .empty-state', { timeout: 3000 });
ck('vista Hoy activa', await p.locator('[data-view=hoy]').evaluate((el) => el.classList.contains('active')));
const hoyTxt = await p.locator('#radar-body').textContent();
ck('vista Hoy: sin eventos hoy o resumen presente', hoyTxt.includes('Sin compromisos') || hoyTxt.includes('evento'));
await p.screenshot({ path: `${SHOT}/radar_4_hoy.png` });

// Navegar a un día con evento conocido (Internet, día 15) usando prev/next
// desde Hoy — probamos que el botón "Anterior"/"Siguiente" cambia el día
const tituloAntes = await p.locator('.radar-title').textContent();
await p.click('#radar-next');
await p.waitForTimeout(300);
const tituloDespues = await p.locator('.radar-title').textContent();
ck('vista Hoy: navegación siguiente cambia el título', tituloAntes !== tituloDespues, `${tituloAntes} -> ${tituloDespues}`);

await p.click('#radar-today');
await p.waitForTimeout(300);
ck('botón Hoy: vuelve al día de hoy', (await p.locator('.radar-title').textContent()) === tituloAntes);

// ══ Vista Mes: navegación prev/next ══
await p.click('[data-view=mes]');
await p.waitForSelector('.cal-grid');
const mesAntes = await p.locator('.radar-title').textContent();
await p.click('#radar-next');
await p.waitForTimeout(300);
const mesDespues = await p.locator('.radar-title').textContent();
ck('vista Mes: siguiente cambia de mes', mesAntes !== mesDespues, `${mesAntes} -> ${mesDespues}`);
await p.click('#radar-prev');
await p.waitForTimeout(300);
ck('vista Mes: anterior regresa al mes original', (await p.locator('.radar-title').textContent()) === mesAntes);

// ══ KPIs presentes en las 3 vistas ══
ck('KPIs: 5 KPIs presentes', await p.locator('.kpis .kpi').count() === 5);

// ══ Regresión: resto de vistas cargan sin errores ══
for (const route of ['dashboard', 'ingresos', 'gastos', 'tarjetas', 'prestamos', 'metas', 'presupuesto', 'admin']) {
  await p.click(`a[data-route=${route}]`);
  await p.waitForTimeout(500);
  const has = await p.locator('#view > *').count();
  ck(`regresión: vista ${route} renderiza`, has > 0);
}

await b.close();
console.log(r.join('\n'));
console.log(`\n${r.filter((x) => x.startsWith('✅')).length} OK / ${r.filter((x) => x.startsWith('❌')).length} FAIL`);
process.exit(bad ? 1 : 0);
