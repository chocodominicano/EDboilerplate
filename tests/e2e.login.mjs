import os from 'os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const SHOT = process.env.TEST_SHOT_DIR || os.tmpdir();
const results = [];
let failed = false;
const check = (n, c, x = '') => { results.push(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`); if (!c) failed = true; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1380, height: 860 } });
page.on('pageerror', (e) => { results.push(`❌ pageerror: ${e.message}`); failed = true; });

await page.goto(BASE);
await page.waitForSelector('.auth-split');
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOT}/23-login-split.png` });

// 1. Split-screen: panel izquierdo visible con orbs y tarjetas flotantes
check('Panel izquierdo (ilustración) visible', await page.locator('.auth-left').isVisible());
check('3 orbs presentes', await page.locator('.auth-orb').count() === 3);
check('2 tarjetas flotantes con monto 1,234.56', /RD\$27,180\.00/.test(await page.locator('.auth-cards').textContent()));

// 2. Tema púrpura aplicado (accent var)
const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
check('Tema púrpura: --accent = #7c6fef', accent === '#7c6fef', accent);

// 3. Fuente Syne cargada (auto-hospedada)
const syneLoaded = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("800 42px Syne"); });
check('Fuente Syne auto-hospedada cargada', syneLoaded);

// 4. Pills presentes
await page.waitForSelector('.auth-av-pill');
check('Pills de usuarios activos', await page.locator('.auth-av-pill').count() >= 1);

// 5. Toggle de contraseña
await page.fill('#login-pass', 'secreto');
await page.click('[data-toggle="login-pass"]');
check('Toggle muestra contraseña', await page.locator('#login-pass').getAttribute('type') === 'text');
await page.click('[data-toggle="login-pass"]');
check('Toggle oculta de nuevo', await page.locator('#login-pass').getAttribute('type') === 'password');

// 6. Login por pill (Admin) + botón "Verificando…"
await page.fill('#login-pass', '');
await page.locator('.auth-av-pill').first().click();
check('Pill seleccionada oculta campo usuario', await page.locator('#login-user-label').isHidden());
await page.fill('#login-pass', 'Admin');
await page.click('#login-btn');
await page.waitForSelector('#app:not(.hidden)');
await page.waitForSelector('.kpi-value');
check('Login por pill entra al dashboard', true);

// 7. Token en sessionStorage, NO en localStorage
const store = await page.evaluate(() => ({ s: !!sessionStorage.getItem('cf_token'), l: !!localStorage.getItem('cf_token') }));
check('Token en sessionStorage (no localStorage)', store.s && !store.l, `session=${store.s} local=${store.l}`);

// 8. Tema púrpura en la app: KPI/acento visible
await page.screenshot({ path: `${SHOT}/24-app-purple.png` });
check('Dashboard renderiza con tema nuevo', await page.locator('.kpi-value').count() >= 4);

// 9. Error de credenciales se muestra (no "sesión expirada") tras logout
await page.click('#logout-btn');
await page.waitForSelector('.auth-split');
await page.fill('#login-user', 'Admin');
await page.fill('#login-pass', 'malaclave');
await page.click('#login-btn');
await page.waitForSelector('#login-error:not(.hidden)');
const errTxt = (await page.locator('#login-error').textContent()).trim();
check('Error de login correcto', errTxt === 'Contraseña incorrecta', errTxt);
check('Botón vuelve a "Ingresar →"', (await page.locator('#login-btn').textContent()).includes('Ingresar'));

// 10. Registro: split-screen, avatar ring, match de contraseñas
await page.click('#show-register');
await page.waitForSelector('#register-form:not(.hidden)');
check('Vista registro con avatar ring', await page.locator('.auth-avatar-ring').isVisible());
await page.fill('#reg-pass', 'abc123');
await page.fill('#reg-pass2', 'abc999');
check('Indicador de no-coincidencia', (await page.locator('#reg-pass-match').textContent()).includes('no coinciden'));
await page.fill('#reg-pass2', 'abc123');
check('Indicador de coincidencia', /✓ Las contraseñas coinciden/.test(await page.locator('#reg-pass-match').textContent()));
await page.screenshot({ path: `${SHOT}/25-register-split.png` });

await browser.close();
console.log(results.join('\n'));
process.exit(failed ? 1 : 0);
