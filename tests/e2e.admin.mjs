import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const SHOT = process.env.TEST_SHOT_DIR || os.tmpdir();
const results = [];
let failed = false;
const check = (name, cond, extra = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed = true;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1380, height: 950 } });
page.on('pageerror', (e) => { results.push(`❌ pageerror: ${e.message}`); failed = true; });

await page.goto(BASE);
await page.waitForSelector('#login-form');

// ── 1. Pills de usuarios activos ──────────────────────────
await page.waitForSelector('.auth-av-pill');
const nPills = await page.locator('.auth-av-pill').count();
check('Pills de usuarios activos visibles', nPills >= 1, `pills=${nPills}`);

// pill de Admin → selecciona y pide solo contraseña
await page.locator('.auth-av-pill').first().click();
const pillMode = await page.locator('#pill-selected').isVisible();
const userHidden = await page.locator('#login-user-label').isHidden();
check('Clic en pill: muestra nombre y oculta campo usuario', pillMode && userHidden);
await page.screenshot({ path: `${SHOT}/17-pills-login.png` });

// login con pill + contraseña
await page.fill('#login-pass', 'Admin');
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#app:not(.hidden)');
await page.waitForSelector('.kpi-value');
check('Login por pill funciona', true);

// ── 2. Formato de moneda 1,234.56 ─────────────────────────
const gastosKpi = (await page.locator('.kpi', { hasText: 'Gastos' }).first().locator('.kpi-value').textContent()).trim();
check('Formato moneda con 2 decimales en dashboard', /RD\$[\d,]+\.\d{2}$/.test(gastosKpi), gastosKpi);

// ── 3. Panel admin visible para admin ─────────────────────
const adminLink = await page.locator('#nav-admin').isVisible();
check('Enlace Administración visible para admin', adminLink);
await page.click('#nav-admin');
await page.waitForSelector('#admin-body .kpi-value');
const kpiTotal = await page.locator('#admin-body .kpi').first().textContent();
check('Tab Usuarios: KPIs renderizan', kpiTotal.includes('Total'));
await page.screenshot({ path: `${SHOT}/18-admin-usuarios.png` });

// ── 4. Detalle de usuario: protecciones propias ───────────
await page.locator('.user-row', { hasText: 'Administrador' }).first().click();
await page.waitForSelector('#user-detail .tabs');
await page.click('[data-udtab=access]');
await page.waitForSelector('#ud-access:not(.hidden)');
const roleDisabled = await page.locator('#ud-role').isDisabled();
const statusDisabled = await page.locator('#ud-status').isDisabled();
const noDelete = (await page.locator('#ud-delete').count()) === 0;
check('Protecciones: rol/estado propios deshabilitados, sin botón eliminar', roleDisabled && statusDisabled && noDelete);

// ── 5. Registro de usuario nuevo (pending) ────────────────
await page.click('#logout-btn');
await page.waitForSelector('#login-form:not(.hidden)');
await page.click('#show-register');
await page.fill('#reg-nombre', 'Pedro');
await page.fill('#reg-apellido', 'Martínez');
await page.fill('#reg-email', 'pedro@test.do');
await page.fill('#reg-phone', '829-555-0202');
await page.fill('#reg-pass', 'pedro2026');
await page.fill('#reg-pass2', 'pedro2026');
const matchTxt = await page.locator('#reg-pass-match').textContent();
check('Indicador de contraseñas coinciden en registro', matchTxt.includes('coinciden') && !matchTxt.includes('no coinciden'), matchTxt.trim());
await page.click('#register-form button[type=submit]');
await page.waitForSelector('#register-ok:not(.hidden)');
const okMsg = await page.locator('#register-ok').textContent();
check('Registro queda pendiente con username autogenerado', okMsg.includes('pmartinez') && okMsg.includes('aprobación'), okMsg.trim());
await page.screenshot({ path: `${SHOT}/19-registro-pendiente.png` });

// ── 6. Login del pendiente → bloqueado ────────────────────
await page.click('#show-login');
await page.fill('#login-user', 'pmartinez');
await page.fill('#login-pass', 'pedro2026');
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#login-error:not(.hidden)');
const errPending = (await page.locator('#login-error').textContent()).trim();
check('Login pendiente bloqueado con mensaje correcto', errPending === 'Cuenta pendiente de aprobación', errPending);

// pmartinez NO aparece en las pills (es pending)
const pillNames = await page.locator('.auth-av-pill').evaluateAll((ps) => ps.map((p) => p.title));
check('Usuario pendiente no aparece en pills', !pillNames.some((n) => n.includes('Pedro')));

// ── 7. Admin aprueba desde la lista ───────────────────────
await page.fill('#login-user', 'Admin');
await page.fill('#login-pass', 'Admin');
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#app:not(.hidden)');
await page.click('#nav-admin');
await page.waitForSelector('[data-approve]');
await page.click('[data-approve]');
await page.waitForSelector('.toast');
await page.waitForFunction(() => !document.querySelector('[data-approve]'));
check('Aprobación rápida desde la lista funciona', true);

// ── 8. Catálogos: agregar categoría y verla en Gastos ─────
await page.click('#admin-body ~ * , [data-tab=categorias]');
await page.waitForSelector('#cat-form');
await page.fill('#cat-form [name=nombre]', 'Viajes');
await page.click('#cat-form button[type=submit]');
await page.waitForSelector('td:has-text("Viajes")');
check('Categoría nueva creada en el panel', true);
await page.screenshot({ path: `${SHOT}/20-admin-categorias.png` });

await page.click('a[data-route=gastos]');
await page.waitForSelector('#expense-form');
const catOptions = await page.locator('#expense-form [name=cat] option').allTextContents();
check('Categoría nueva aparece en el formulario de gastos', catOptions.includes('Viajes'), `${catOptions.length} categorías`);
const metOptions = await page.locator('#expense-form [name=metodo] option').allTextContents();
check('Métodos de pago vienen del catálogo', metOptions.includes('Efectivo') && metOptions.includes('Transferencia'), metOptions.join(', '));

// ── 9. Logs del sistema ───────────────────────────────────
await page.click('#nav-admin');
await page.waitForSelector('[data-tab=logs]');
await page.click('[data-tab=logs]');
await page.waitForSelector('#admin-body table');
const logsTxt = await page.locator('#admin-body').textContent();
check('Logs registran aprobación, registro y logins',
  logsTxt.includes('Aprobación') && logsTxt.includes('Registro de usuario') && logsTxt.includes('Login'));
await page.screenshot({ path: `${SHOT}/21-admin-logs.png` });

// ── 10. Usuario aprobado entra; ve "Mi cuenta" limitada ────
await page.click('#logout-btn');
await page.waitForSelector('#login-form:not(.hidden)');
await page.fill('#login-user', 'pedro@test.do');
await page.fill('#login-pass', 'pedro2026');
await page.click('#login-form button[type=submit]');
await page.waitForSelector('#app:not(.hidden)');
check('Usuario aprobado entra (login por correo)', true);
check('Enlace Administración visible para rol user', await page.locator('#nav-admin').isVisible());

await page.goto(BASE + '/#/admin');
await page.waitForSelector('#pf-form');
const userTabsTxt = await page.locator('#view .tabs').textContent();
check('Usuario ve tabs Mi perfil + catálogos, sin Usuarios ni Logs',
  userTabsTxt.includes('Mi perfil') && userTabsTxt.includes('Categorías')
  && !userTabsTxt.includes('Usuarios') && !userTabsTxt.includes('Logs'));

// Mi perfil: editar nombre actualiza el topbar
await page.fill('#pf-form [name=apellido]', 'Martínez Prueba');
await page.click('#pf-form button[type=submit]');
await page.waitForFunction(() => document.querySelector('#topbar-user').textContent.includes('Martínez Prueba'));
check('Editar perfil actualiza nombre en el topbar', true);
// guardar re-renderiza la vista; esperar antes de usar el form de contraseña
await page.waitForTimeout(500);

// Cambio de contraseña: actual incorrecta rechaza, correcta funciona
await page.fill('#pw-form [name=actual]', 'incorrecta');
await page.fill('#pw-form [name=nueva]', 'nuevo2026');
await page.fill('#pw-form [name=confirmar]', 'nuevo2026');
await page.click('#pw-form button[type=submit]');
await page.waitForSelector('.toast:has-text("contraseña actual es incorrecta")');
check('Cambio de contraseña con actual incorrecta se rechaza', true);
await page.fill('#pw-form [name=actual]', 'pedro2026');
await page.click('#pw-form button[type=submit]');
await page.waitForSelector('.toast:has-text("Contraseña actualizada")');
check('Cambio de contraseña propio funciona', true);

// Catálogos como user: puede agregar, no ve eliminar
await page.click('[data-tab=categorias]');
await page.waitForSelector('#cat-form');
await page.fill('#cat-form [name=nombre]', 'Categoría de Pedro');
await page.click('#cat-form button[type=submit]');
await page.waitForSelector('td:has-text("Categoría de Pedro")');
check('Usuario normal puede agregar categoría', true);
check('Usuario normal ve renombrar pero no eliminar',
  (await page.locator('#admin-body [data-rename]').count()) > 0
  && (await page.locator('#admin-body [data-del]').count()) === 0);
await page.screenshot({ path: `${SHOT}/22-mi-cuenta-user.png` });

await browser.close();
console.log(results.join('\n'));
process.exit(failed ? 1 : 0);
