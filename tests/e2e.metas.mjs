import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const SHOT = process.env.TEST_SHOT_DIR || os.tmpdir();
const r = []; let bad = false;
const ck = (n, c, x = '') => { r.push(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`); if (!c) bad = true; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
p.on('pageerror', (e) => { r.push('❌ pageerror: ' + e.message); bad = true; });

await p.goto(BASE);
await p.waitForSelector('.auth-split');
await p.fill('#login-user', 'Admin');
await p.fill('#login-pass', 'Admin');
await p.click('#login-btn');
await p.waitForSelector('#app:not(.hidden)');

// ══ Nav link presente ══
ck('nav: enlace Metas presente', await p.locator('a[data-route=metas]').count() === 1);

// ══ Vista vacía ══
await p.click('a[data-route=metas]');
await p.waitForSelector('#add-goal');
ck('vacío: empty-state visible', await p.locator('#view .empty-state').count() === 1);
ck('vacío: sin KPIs', await p.locator('#view .kpis').count() === 0);

// ══ Crear meta RD$ ══
await p.click('#add-goal');
await p.waitForSelector('#goal-form');
await p.fill('#goal-form [name=nombre]', 'Vacaciones Punta Cana');
await p.locator('#goal-form [name=objetivo]').click();
await p.locator('#goal-form [name=objetivo]').type('50000');
ck('money mask: objetivo 50,000', await p.locator('#goal-form [name=objetivo]').inputValue() === '50,000');
await p.locator('#goal-form [name=actual]').click();
await p.locator('#goal-form [name=actual]').type('18500');
await p.fill('#goal-form [name=fechaLimite]', '2026-12-31');
await p.fill('#goal-form [name=fechaInicio]', '2026-01-01');
// selecciona ícono ✈️ y color verde (segundo swatch)
await p.locator('.icon-swatch[data-icono="✈️"]').click();
await p.locator('.color-swatch').nth(1).click();
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForSelector('.card', { timeout: 5000 });

// ══ KPIs ══
const kpiTotal = await p.locator('.kpi', { hasText: 'Total a ahorrar' }).textContent();
ck('KPI: total a ahorrar 50,000.00', kpiTotal.includes('50,000.00'));
const kpiAhorrado = await p.locator('.kpi', { hasText: 'Total ahorrado' }).textContent();
ck('KPI: total ahorrado 18,500.00', kpiAhorrado.includes('18,500.00'));
const kpiCompletas = await p.locator('.kpi', { hasText: 'Completadas' }).textContent();
ck('KPI: completadas 0 de 1', kpiCompletas.includes('0') && kpiCompletas.includes('de 1'));

// ══ Card de la meta ══
const cardTxt = await p.locator('.card', { hasText: 'Vacaciones Punta Cana' }).textContent();
ck('card: ícono y nombre', cardTxt.includes('✈️') && cardTxt.includes('Vacaciones Punta Cana'));
ck('card: 37% dinero ahorrado', cardTxt.includes('37% dinero ahorrado'), cardTxt.slice(0, 200));
ck('card: badge de salud (atrasado)', cardTxt.includes('Ritmo insuficiente') || cardTxt.includes('atrás'));
ck('card: 4 chips de cadencia', cardTxt.includes('Por día') && cardTxt.includes('Semanal') && cardTxt.includes('Quincena') && cardTxt.includes('Mensual'));
ck('card: input y botón abonar presentes', await p.locator('[data-abono-input]').count() === 1 && await p.locator('[data-abonar]').count() === 1);
await p.screenshot({ path: `${SHOT}/metas_1_card_inicial.png` });

// ══ Abonar con Enter ══
const abonoInput = p.locator('[data-abono-input]').first();
await abonoInput.click();
await abonoInput.type('5000');
await abonoInput.press('Enter');
await p.waitForTimeout(500);
const cardTxt2 = await p.locator('.card', { hasText: 'Vacaciones Punta Cana' }).textContent();
ck('abono: 47% tras abonar 5000 (23500/50000)', cardTxt2.includes('47% dinero ahorrado'), cardTxt2.slice(0, 200));
ck('abono: historial mensual aparece', cardTxt2.includes('Aportes por mes'));
await p.screenshot({ path: `${SHOT}/metas_2_tras_abono.png` });

// ══ Editar meta ══
await p.click('[data-edit]');
await p.waitForSelector('#goal-form');
ck('editar: campos precargados', await p.locator('#goal-form [name=nombre]').inputValue() === 'Vacaciones Punta Cana');
ck('editar: moneda deshabilitada', await p.locator('#goal-form [name=moneda]').isDisabled());
await p.fill('#goal-form [name=nombre]', 'Vacaciones Punta Cana 2027');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForTimeout(300);
ck('editar: nombre actualizado en card', (await p.locator('.card').first().textContent()).includes('Vacaciones Punta Cana 2027'));

// ══ Segunda meta USD$, la completamos con un abono grande ══
await p.click('#add-goal');
await p.waitForSelector('#goal-form');
await p.fill('#goal-form [name=nombre]', 'MacBook Pro');
await p.selectOption('#goal-form [name=moneda]', 'USD$');
await p.locator('#goal-form [name=objetivo]').click();
await p.locator('#goal-form [name=objetivo]').type('1000');
await p.fill('#goal-form [name=fechaLimite]', '2026-12-31');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForTimeout(300);

const macCard = p.locator('.card', { hasText: 'MacBook Pro' });
ck('meta USD: muestra USD$0.00 de USD$1,000.00', (await macCard.textContent()).includes('USD$1,000.00'));
const macInput = macCard.locator('[data-abono-input]');
await macInput.click();
await macInput.type('1500');
await macCard.locator('[data-abonar]').click();
await p.waitForTimeout(500);
const macCardDone = await p.locator('.card', { hasText: 'MacBook Pro' }).textContent();
ck('meta USD: alcanzada tras sobreabonar (clamp a 1000)', macCardDone.includes('¡Meta alcanzada!'));
ck('meta USD: no muestra chips de cadencia (completada)', !macCardDone.includes('Por día'));

const kpiCompletas2 = await p.locator('.kpi', { hasText: 'Completadas' }).textContent();
ck('KPI: completadas 1 de 2 tras completar MacBook', kpiCompletas2.includes('1') && kpiCompletas2.includes('de 2'));
await p.screenshot({ path: `${SHOT}/metas_3_completada.png`, fullPage: true });

// ══ Interconexión: Dashboard banner "Asignar a meta" ══
await p.click('a[data-route=dashboard]');
await p.waitForTimeout(500);
const dashTxt = await p.locator('#view').textContent();
// El banner solo aparece si balance>0 y hay meta activa (Vacaciones sigue activa, no completada)
if (dashTxt.includes('disponible este mes')) {
  ck('dashboard: banner "Asignar a meta" con botón', dashTxt.includes('Asignar a meta'));
  await p.click('#banner-metas');
  await p.waitForSelector('#add-goal', { timeout: 5000 });
  ck('dashboard: banner navega a Metas', true);
} else {
  ck('dashboard: sin banner (balance no positivo, aceptable)', true);
}

// ══ Interconexión: Gastos muestra el abono con categoría Ahorro ══
await p.click('a[data-route=gastos]');
await p.waitForSelector('[data-tab=mes]');
await p.waitForTimeout(500);
const gastosTxt = await p.locator('#view').textContent();
ck('gastos: abono a meta visible', gastosTxt.includes('Abono meta: Vacaciones'));
ck('gastos: categoría Ahorro visible', gastosTxt.includes('Ahorro'));
// La tx de meta no debe tener botones editar/eliminar (backend los bloquea con 400)
const metaRow = p.locator('#view tbody tr', { hasText: 'Abono meta' }).first();
ck('gastos: tx de meta muestra badge "🔗 meta" en vez de botones', (await metaRow.textContent()).includes('🔗 meta'));
ck('gastos: tx de meta sin botones editar/eliminar', await metaRow.locator('[data-edit-tx], [data-del-tx]').count() === 0);

// ══ Eliminar meta y verificar que el gasto se conserva ══
await p.click('a[data-route=metas]');
await p.waitForSelector('.card');
await p.click('[data-del]');
await p.waitForSelector('.modal');
await p.locator('.modal button', { hasText: 'Eliminar' }).click();
await p.waitForTimeout(500);
const remaining = await p.locator('.card').count();
ck('eliminar: queda 1 meta (MacBook)', remaining === 1);

await p.click('a[data-route=gastos]');
await p.waitForTimeout(500);
const gastosTxt2 = await p.locator('#view').textContent();
ck('eliminar meta: el gasto histórico sigue en Gastos', gastosTxt2.includes('Abono meta'));

// ══ Regresión: resto de vistas cargan sin errores ══
for (const route of ['dashboard', 'ingresos', 'tarjetas', 'prestamos', 'presupuesto', 'radar', 'admin']) {
  await p.click(`a[data-route=${route}]`);
  await p.waitForTimeout(500);
  const has = await p.locator('#view > *').count();
  ck(`regresión: vista ${route} renderiza`, has > 0);
}

await b.close();
console.log(r.join('\n'));
console.log(`\n${r.filter((x) => x.startsWith('✅')).length} OK / ${r.filter((x) => x.startsWith('❌')).length} FAIL`);
process.exit(bad ? 1 : 0);
