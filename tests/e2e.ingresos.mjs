import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOT = process.env.TEST_SHOT_DIR || os.tmpdir();
const r = []; let bad = false;
const ck = (n, c, x = '') => { r.push(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`); if (!c) bad = true; };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1380, height: 1000 } });
p.on('pageerror', (e) => { r.push('❌ pageerror: ' + e.message); bad = true; });

await p.goto(BASE);
await p.waitForSelector('.auth-split');
await p.fill('#login-user', 'Admin'); await p.fill('#login-pass', 'Admin');
await p.click('#login-btn');
await p.waitForSelector('#app:not(.hidden)');

await p.click('a[data-route=ingresos]');
await p.waitForSelector('#income-form');

// 1. 4 KPIs presentes
ck('4 KPIs de ingresos', await p.locator('#view .kpis .kpi').count() === 4);

// 2. Fecha híbrida: Q1 muestra mes, oculta fecha exacta
ck('Q1: input de mes visible', await p.locator('#ing-mes-grp').isVisible() && await p.locator('#ing-fecha-grp').isHidden());
await p.selectOption('#ing-quincena', 'exacta');
ck('Exacta: calendario visible, mes oculto', await p.locator('#ing-fecha-grp').isVisible() && await p.locator('#ing-mes-grp').isHidden());
await p.selectOption('#ing-quincena', 'q1');

// 3. Máscara de monto en vivo (1,234.56)
await p.fill('#income-form [name=mesAnio]', '2026-07');
await p.fill('#income-form [name=fuente]', 'Titular');
await p.fill('#income-form [name=nombre]', 'Salario');
await p.locator('#income-form [name=monto]').click();
await p.locator('#income-form [name=monto]').type('34250');
const montoVal = await p.locator('#income-form [name=monto]').inputValue();
ck('Monto con separadores 1,234', montoVal === '34,250', montoVal);

// 4. Chip de preview aparece
ck('Chip de preview visible', await p.locator('#ing-preview').isVisible());

// 5. Registrar → aparece en historial con 1ra Q
await p.click('#income-form button[type=submit]');
await p.waitForSelector('table td:has-text("Salario")');
ck('Ingreso registrado en historial', /1ra Q/.test(await p.locator('#view').textContent()));

// 6. Segunda fuente → contribución por fuente aparece
await p.fill('#income-form [name=fuente]', 'Freelance');
await p.fill('#income-form [name=nombre]', 'Proyecto web');
await p.locator('#income-form [name=monto]').type('12000');
await p.click('#income-form button[type=submit]');
await p.waitForSelector('h3:has-text("Contribución por fuente")');
ck('Contribución por fuente con 2 fuentes', /Titular/.test(await p.locator('#view').textContent()) && /Freelance/.test(await p.locator('#view').textContent()));
await p.screenshot({ path: `${SHOT}/26-ingresos.png` });

// 7. KPI total del mes = 46,250.00
const totalKpi = (await p.locator('.kpi', { hasText: 'Total del mes' }).first().locator('.kpi-value').textContent()).trim();
ck('KPI total del mes formato 46,250.00', totalKpi === 'RD$46,250.00', totalKpi);

// 8. Filtro por fuente
await p.selectOption('#filtro-fuente', 'Freelance');
await p.waitForTimeout(300);
const filtered = await p.locator('#view tbody tr').count();
ck('Filtro por fuente deja 1 registro', filtered === 1, `${filtered} filas`);
await p.selectOption('#filtro-fuente', '');
await p.waitForTimeout(300);

// 9. Editar ingreso
await p.locator('[data-edit-tx]').first().click();
await p.waitForSelector('#edit-ing');
const editMonto = await p.locator('#edit-ing [name=monto]').inputValue();
ck('Modal editar pre-pobla monto formateado', /,/.test(editMonto) || editMonto.includes('.'), editMonto);
await p.fill('#edit-ing [name=monto]', '');
await p.locator('#edit-ing [name=monto]').type('40000');
await p.click('[data-act=save]');
await p.waitForSelector('#edit-ing', { state: 'detached' });
await p.waitForTimeout(400);
ck('Ingreso editado refleja nuevo monto', /RD\$40,000\.00/.test(await p.locator('#view').textContent()));

// 10. Ingreso fijo: agregar, toggle activo, recibir
await p.fill('#fixed-income-form [name=descripcion]', 'Renta apto');
await p.locator('#fixed-income-form [name=monto]').type('15000');
await p.fill('#fixed-income-form [name=dia]', '5');
await p.click('#fixed-income-form button[type=submit]');
await p.waitForSelector('td:has-text("Renta apto")');
ck('Ingreso fijo agregado', true);
await p.locator('[data-toggle-fixed]').first().click();
await p.waitForSelector('.badge-muted');
ck('Toggle desactiva el fijo', /inactivo/.test(await p.locator('#view').textContent()));
await p.locator('[data-toggle-fixed]').first().click();
await p.waitForTimeout(300);
await p.locator('[data-receive]').first().click();
await p.waitForSelector('.badge-ok');
ck('Marcar recibido funciona', /recibido/.test(await p.locator('#view').textContent()));

// 11. No se rompió nada: dashboard y gastos cargan
await p.click('a[data-route=dashboard]'); await p.waitForSelector('.kpi-value'); ck('Dashboard sigue cargando', true);
await p.click('a[data-route=gastos]'); await p.waitForSelector('#expense-form'); ck('Gastos sigue cargando', true);

await b.close();
console.log(r.join('\n'));
process.exit(bad ? 1 : 0);
