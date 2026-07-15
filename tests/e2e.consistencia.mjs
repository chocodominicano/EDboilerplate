const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const r = []; let bad = false;
const ck = (n, c, x = '') => { r.push(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`); if (!c) bad = true; };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on('pageerror', (e) => { r.push('❌ pageerror: ' + e.message); bad = true; });

await p.goto(BASE);
await p.waitForSelector('.auth-split');
ck('C3: sin hint demo/1234 en login', !(await p.locator('.auth-split').textContent()).includes('demo / 1234'));
await p.fill('#login-user', 'Admin'); await p.fill('#login-pass', 'Admin');
await p.click('#login-btn');
await p.waitForSelector('#app:not(.hidden)');

// ── D1: máscara en Presupuesto ──
await p.click('a[data-route=presupuesto]');
await p.waitForSelector('#budget-form');
await p.locator('#budget-form [name=monto]').click();
await p.locator('#budget-form [name=monto]').type('12500.5');
ck('D1 presupuesto: máscara 12,500.5', await p.locator('#budget-form [name=monto]').inputValue() === '12,500.5');
await p.locator('#budget-form button[type=submit]').click();
await p.waitForSelector('#view tbody tr');
ck('D1 presupuesto: guardado 12,500.50', (await p.locator('#view tbody tr').first().textContent()).includes('12,500.50'));

// ── D1: máscara en gastos fijos (tab) ──
await p.click('a[data-route=gastos]');
await p.waitForSelector('[data-tab=fijos]');
await p.click('[data-tab=fijos]');
await p.waitForSelector('#fixed-exp-form');
await p.fill('#fixed-exp-form [name=concepto]', 'Internet QA');
await p.locator('#fixed-exp-form [name=monto]').click();
await p.locator('#fixed-exp-form [name=monto]').type('2350');
ck('D1 fijos: máscara 2,350', await p.locator('#fixed-exp-form [name=monto]').inputValue() === '2,350');
await p.fill('#fixed-exp-form [name=dia]', '10');
await p.locator('#fixed-exp-form button[type=submit]').click();
await p.waitForTimeout(500);
ck('D1 fijos: creado RD$2,350.00', (await p.locator('#view').textContent()).includes('2,350.00'));

// ── D1: máscara en formulario de tarjeta ──
await p.click('a[data-route=tarjetas]');
await p.waitForSelector('#add-card');
await p.click('#add-card');
await p.waitForSelector('#card-form');
await p.fill('#card-form [name=label]', 'QA Visa');
const limitInput = p.locator('#card-form [name=limitRD]');
await limitInput.click();
await limitInput.press('Control+a');
await limitInput.type('150000');
ck('D1 tarjeta: máscara límite 150,000', await limitInput.inputValue() === '150,000');
await p.fill('#card-form [name=diaCorte]', '5');
await p.fill('#card-form [name=diaPago]', '20');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
ck('D1 tarjeta: creada con límite 150,000.00', (await p.locator('#view').textContent()).includes('150,000.00'));

// ── D2: crear gasto y editarlo ──
await p.click('a[data-route=gastos]');
await p.waitForSelector('[data-tab=mes]');
await p.click('[data-tab=mes]');
// el clic en la tab re-renderiza la vista async; esperar a que el DOM
// se estabilice antes de llenar el formulario (evita que el re-render
// borre lo escrito)
await p.waitForTimeout(600);
await p.waitForSelector('#expense-form');
await p.fill('#expense-form [name=nombre]', 'Cine QA');
await p.locator('#expense-form [name=monto]').click();
await p.locator('#expense-form [name=monto]').type('1500');
await p.locator('#expense-form button[type=submit]').click();
await p.waitForTimeout(600);
await p.waitForSelector('[data-edit-tx]');
await p.locator('[data-edit-tx]').first().click();
await p.waitForSelector('#edit-gasto');
ck('D2: modal editar con monto 1,500.00', await p.locator('#edit-gasto [name=monto]').inputValue() === '1,500.00');
await p.fill('#edit-gasto [name=nombre]', 'Cine IMAX QA');
const montoEdit = p.locator('#edit-gasto [name=monto]');
await montoEdit.click();
await montoEdit.press('Control+a');
await montoEdit.type('1750.25');
await p.locator('.modal [data-act=save]').click();
await p.waitForTimeout(600);
const gtxt = await p.locator('#view').textContent();
ck('D2: gasto editado nombre y monto', gtxt.includes('Cine IMAX QA') && gtxt.includes('1,750.25'));

// ── D2: tx de préstamo muestra badge vinculado sin acciones ──
await p.click('a[data-route=prestamos]');
await p.waitForSelector('#add-loan');
await p.click('#add-loan');
await p.waitForSelector('#loan-form');
await p.fill('#loan-form [name=nombre]', 'Préstamo QA');
await p.locator('#loan-form [name=original]').click();
await p.locator('#loan-form [name=original]').type('50000');
await p.fill('#loan-form [name=tasaAnual]', '12');
await p.fill('#loan-form [name=plazoMeses]', '12');
await p.fill('#loan-form [name=diaPago]', '15');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.click('[data-pay="1"]');
await p.waitForSelector('.modal');
await p.locator('.modal button', { hasText: 'Pagar cuota' }).click();
await p.waitForTimeout(500);
await p.click('a[data-route=gastos]');
await p.waitForTimeout(600);
const rows = await p.locator('#view tbody tr').allTextContents();
const loanRow = rows.find((t) => t.includes('Cuota Préstamo QA'));
ck('D2: fila de préstamo con badge vinculado', !!loanRow && loanRow.includes('préstamo'));
const editBtns = await p.locator('#view tbody tr', { hasText: 'Cuota Préstamo QA' }).locator('[data-edit-tx], [data-del-tx]').count();
ck('D2: fila de préstamo sin botones editar/eliminar', editBtns === 0);

// ── D3: radar sin evento de pago de tarjeta con deuda 0 ──
await p.click('a[data-route=radar]');
await p.waitForTimeout(600);
const radarTxt = await p.locator('#view').textContent();
ck('D3: sin evento "Pago QA Visa" (deuda 0)', !radarTxt.includes('Pago QA Visa'));
ck('D3: gasto fijo sí aparece en radar', radarTxt.includes('Internet QA'));

// ── D1: modal pagar tarjeta con máscara ──
await p.click('a[data-route=tarjetas]');
await p.waitForSelector('[data-pay]');
await p.locator('[data-pay]').first().click();
await p.waitForSelector('#pay-form');
await p.locator('#pay-form [name=monto]').click();
await p.locator('#pay-form [name=monto]').type('5000.75');
ck('D1 pago tarjeta: máscara 5,000.75', await p.locator('#pay-form [name=monto]').inputValue() === '5,000.75');

await b.close();
console.log(r.join('\n'));
console.log(`\n${r.filter((x) => x.startsWith('✅')).length} OK / ${r.filter((x) => x.startsWith('❌')).length} FAIL`);
process.exit(bad ? 1 : 0);
