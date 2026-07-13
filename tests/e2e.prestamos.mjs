import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

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

// ══ 1. Vista vacía ══
await p.click('a[data-route=prestamos]');
await p.waitForSelector('#add-loan');
ck('vacío: empty-state visible', await p.locator('#view .empty-state').count() === 1);
ck('vacío: sin KPIs ni estrategia', await p.locator('#view .kpis').count() === 0 && await p.locator('#estrategia-card').count() === 0);

// ══ 2. Alta con modo "primer pago" + preview + simulador ══
await p.click('#add-loan');
await p.waitForSelector('#loan-form');
await p.fill('#loan-form [name=nombre]', 'Préstamo Vehículo');
await p.fill('#loan-form [name=banco]', 'Banco Popular');
await p.locator('#loan-form [name=original]').click();
await p.locator('#loan-form [name=original]').type('500000');
ck('money mask: 500,000.00', await p.locator('#loan-form [name=original]').inputValue() === '500,000');
await p.fill('#loan-form [name=tasaAnual]', '12');
await p.fill('#loan-form [name=plazoMeses]', '60');
await p.fill('#loan-form [name=diaPago]', '15');
await p.fill('#loan-form [name=penalidadPct]', '2');
await p.selectOption('#loan-form [name=modoFecha]', 'primer_pago');
const fechaLabel = await p.locator('#fecha-label').textContent();
ck('modo fecha: label cambia a "primer pago"', fechaLabel.includes('primer pago'));
await p.fill('#loan-form [name=fecha]', '2026-08-15');
await p.waitForTimeout(150);
const prev = await p.locator('#loan-preview').textContent();
ck('preview: cuota RD$11,122.22', prev.includes('11,122.22'), prev.trim().slice(0, 120));
ck('preview: inicio derivado 2026-07-15', prev.includes('2026-07-15'));
ck('preview: total a pagar 667,333', prev.includes('667,333'));

// Simulador de tabla completa ANTES de crear
await p.click('[data-act=tabla]');
await p.waitForSelector('.modal:last-of-type table');
const simRows = await p.locator('.modal:last-of-type tbody tr').count();
ck('simulador: 60 filas', simRows === 60, String(simRows));
const lastSaldo = await p.locator('.modal:last-of-type tbody tr:last-child td:last-child').textContent();
ck('simulador: saldo final RD$0.00', lastSaldo.trim() === 'RD$0.00', lastSaldo.trim());
await p.screenshot({ path: `${SHOT}/prest_1_simulador.png` });
await p.locator('.modal:last-of-type [data-act=close]').click();
await p.waitForTimeout(200);

await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForSelector('#view table tbody tr');
const row1 = await p.locator('#view tbody tr').first().textContent();
ck('fila: cuota 11,122.22 y saldo 500,000.00', row1.includes('11,122.22') && row1.includes('500,000.00'));
ck('fila: subtítulo tasa + penalidad', row1.includes('12% anual') && row1.includes('penalidad 2%'));
ck('fila: próx. pago 15/08 (inicio derivado)', row1.includes('15/08'));
ck('KPI: saldo total 500,000.00', (await p.locator('.kpi', { hasText: 'Saldo pendiente total' }).textContent()).includes('500,000.00'));
ck('KPI: intereses pagados 0.00', (await p.locator('.kpi', { hasText: 'Intereses/cargos' }).textContent()).includes('RD$0.00'));

// ══ 3. Pagar cuota ══
await p.click('[data-pay="1"]');
await p.waitForSelector('.modal');
await p.locator('.modal button', { hasText: 'Pagar cuota' }).click();
await p.waitForSelector('#view table tbody tr');
await p.waitForTimeout(300);
const rowPaid = await p.locator('#view tbody tr').first().textContent();
ck('pago: saldo 493,877.78', rowPaid.includes('493,877.78'), rowPaid.slice(0, 100));
ck('pago: progreso 1.22% amortizado', rowPaid.includes('1.22% amortizado'));
ck('KPI: intereses pagados 5,000.00', (await p.locator('.kpi', { hasText: 'Intereses/cargos' }).textContent()).includes('5,000.00'));

// ══ 4. Detalle: pagos reales + proyección ══
await p.click('[data-detalle="1"]');
await p.waitForSelector('.modal h3');
const detTxt = await p.locator('.modal').textContent();
ck('detalle: 1 pago realizado', detTxt.includes('Pagos realizados (1)'));
ck('detalle: cuota registrada 11,122.22', detTxt.includes('Cuota Préstamo Vehículo') && detTxt.includes('11,122.22'));
ck('detalle: proyección 59 cuotas restantes', detTxt.includes('proyección: 59'));
ck('detalle: interés restante proyectado', detTxt.includes('interés restante proyectado'));
await p.screenshot({ path: `${SHOT}/prest_2_detalle.png` });
await p.locator('.modal [data-act=close]').click();
await p.waitForTimeout(200);

// ══ 5. Abono extra con simulación en vivo ══
await p.click('[data-extra="1"]');
await p.waitForSelector('#extra-form');
ck('extra: botón aplicar deshabilitado sin monto', await p.locator('[data-act=apply]').isDisabled());
await p.locator('#extra-form [name=monto]').click();
await p.locator('#extra-form [name=monto]').type('50000');
await p.waitForSelector('#extra-sim table', { timeout: 5000 });
const simTxt = await p.locator('#extra-sim').textContent();
ck('extra sim: penalidad 1,000.00', simTxt.includes('1,000.00'));
ck('extra sim: desembolso 51,000.00', simTxt.includes('51,000.00'));
ck('extra sim: comparación 3 columnas', simTxt.includes('Sin abono') && simTxt.includes('Reducir plazo') && simTxt.includes('Reducir cuota'));
ck('extra sim: ahorro neto presente', simTxt.includes('Ahorro neto'));
await p.screenshot({ path: `${SHOT}/prest_3_abono_sim.png` });
ck('extra: aplicar habilitado con sim', !(await p.locator('[data-act=apply]').isDisabled()));
await p.click('[data-act=apply]');
await p.waitForSelector('.modal:last-of-type', { timeout: 3000 });
await p.locator('.modal:last-of-type button', { hasText: 'Aplicar abono' }).last().click();
await p.waitForTimeout(500);
const rowExtra = await p.locator('#view tbody tr').first().textContent();
ck('extra plazo: saldo 443,877.78', rowExtra.includes('443,877.78'), rowExtra.slice(0, 100));
ck('extra plazo: cuota intacta 11,122.22', rowExtra.includes('11,122.22'));

// ══ 6. Segundo préstamo (modo inicio) → estrategia aparece ══
await p.click('#add-loan');
await p.waitForSelector('#loan-form');
await p.fill('#loan-form [name=nombre]', 'Préstamo Personal');
await p.fill('#loan-form [name=banco]', 'BHD');
await p.locator('#loan-form [name=original]').click();
await p.locator('#loan-form [name=original]').type('100000');
await p.fill('#loan-form [name=tasaAnual]', '24');
await p.fill('#loan-form [name=plazoMeses]', '24');
await p.fill('#loan-form [name=diaPago]', '5');
await p.fill('#loan-form [name=fecha]', '2026-07-01');
await p.click('[data-act=save]');
await p.waitForSelector('.modal', { state: 'detached' });
await p.waitForSelector('#estrategia-card');
ck('estrategia: card visible con 2 activos', true);

// ══ 7. Estrategia nieve vs avalancha ══
await p.locator('#est-extra').click();
await p.locator('#est-extra').type('5000');
await p.click('#est-calcular');
await p.waitForSelector('#est-result table', { timeout: 5000 });
const estTxt = await p.locator('#est-result').textContent();
ck('estrategia: columnas nieve y avalancha', estTxt.includes('Bola de nieve') && estTxt.includes('Avalancha'));
ck('estrategia: orden Personal → Vehículo', estTxt.includes('Préstamo Personal → Préstamo Vehículo'));
ck('estrategia: ahorro y nota penalidades', estTxt.includes('Ahorro vs sin extra') && estTxt.includes('penalidades'));
await p.screenshot({ path: `${SHOT}/prest_4_estrategia.png`, fullPage: true });

// ══ 8. Abono reducir_cuota en préstamo 2 ══
await p.click('[data-extra="2"]');
await p.waitForSelector('#extra-form');
await p.locator('#extra-form [name=monto]').click();
await p.locator('#extra-form [name=monto]').type('20000');
await p.selectOption('#extra-form [name=modo]', 'reducir_cuota');
await p.waitForSelector('#extra-sim table', { timeout: 5000 });
const sim2 = await p.locator('#extra-sim').textContent();
ck('extra 2 sim: sin penalidad (0%)', !sim2.includes('Penalidad:'));
ck('extra 2 sim: nueva cuota 4,229.69', sim2.includes('4,229.69'), sim2.slice(0, 200));
await p.click('[data-act=apply]');
await p.waitForSelector('.modal:last-of-type', { timeout: 3000 });
await p.locator('.modal:last-of-type button', { hasText: 'Aplicar abono' }).last().click();
await p.waitForTimeout(500);
const rows2 = await p.locator('#view tbody tr').allTextContents();
const rowP2 = rows2.find((t) => t.includes('Personal'));
ck('extra cuota: saldo 80,000.00 y cuota 4,229.69', rowP2.includes('80,000.00') && rowP2.includes('4,229.69'), (rowP2 || '').slice(0, 110));

// ══ 9. Liquidación total ══
await p.click('[data-extra="2"]');
await p.waitForSelector('#extra-form');
await p.locator('#extra-form [name=monto]').click();
await p.locator('#extra-form [name=monto]').type('80000');
await p.waitForSelector('#extra-sim div', { timeout: 5000 });
await p.waitForFunction(() => document.querySelector('#extra-sim')?.textContent.includes('liquida'));
ck('liquidación: aviso "liquida el préstamo"', true);
await p.click('[data-act=apply]');
await p.waitForSelector('.modal:last-of-type', { timeout: 3000 });
await p.locator('.modal:last-of-type button', { hasText: 'Aplicar abono' }).last().click();
await p.waitForTimeout(500);
const rows3 = await p.locator('#view tbody tr').allTextContents();
const rowSald = rows3.find((t) => t.includes('Personal'));
ck('liquidación: badge saldado + saldo 0.00', rowSald.includes('saldado') && rowSald.includes('RD$0.00'), (rowSald || '').slice(0, 110));
ck('liquidación: KPI activos = 1', (await p.locator('.kpi', { hasText: 'Activos' }).textContent()).includes('1'));
ck('liquidación: estrategia desaparece (<2 activos)', await p.locator('#estrategia-card').count() === 0);
ck('liquidación: sin botón pagar en saldado', !rowSald.includes('Pagar cuota'));
await p.screenshot({ path: `${SHOT}/prest_5_final.png`, fullPage: true });

// ══ 10. Interconexión: dashboard ══
await p.click('a[data-route=dashboard]');
await p.waitForSelector('#view .kpi');
await p.waitForTimeout(400);
const dashTxt = await p.locator('#view').textContent();
ck('dashboard: deuda préstamos 443,877.78', dashTxt.includes('443,877.78'));
ck('dashboard: pago mínimo incluye cuota 11,122.22', dashTxt.includes('11,122.22'));

// ══ 11. Interconexión: radar ══
await p.click('a[data-route=radar]');
await p.waitForSelector('#view');
await p.waitForTimeout(400);
const radarTxt = await p.locator('#view').textContent();
ck('radar: evento Cuota Préstamo Vehículo', radarTxt.includes('Préstamo Vehículo'));

// ══ 12. Interconexión: gastos (pagos préstamo = gastos) ══
await p.click('a[data-route=gastos]');
await p.waitForSelector('#view table, #view .empty-state');
await p.waitForTimeout(400);
const gastosTxt = await p.locator('#view').textContent();
ck('gastos: cuota visible como gasto', gastosTxt.includes('Cuota Préstamo Vehículo'));
ck('gastos: abono extra visible', gastosTxt.includes('Abono extra'));
ck('gastos: categoría Préstamos', gastosTxt.includes('Préstamos'));

// ══ 13. Regresión: demás vistas cargan sin errores ══
for (const route of ['ingresos', 'tarjetas', 'presupuesto', 'admin']) {
  await p.click(`a[data-route=${route}]`);
  await p.waitForTimeout(500);
  const has = await p.locator('#view > *').count();
  ck(`regresión: vista ${route} renderiza`, has > 0);
}

await b.close();
console.log(r.join('\n'));
console.log(`\n${r.filter((x) => x.startsWith('✅')).length} OK / ${r.filter((x) => x.startsWith('❌')).length} FAIL`);
process.exit(bad ? 1 : 0);
