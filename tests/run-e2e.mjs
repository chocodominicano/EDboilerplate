// Runner de las suites E2E: levanta el servidor con una DB temporal
// (NUNCA toca tu financiero.db) y corre cada suite sobre una DB limpia.
//
// Requisitos: npm i -D playwright && npx playwright install chromium
//   (o exporta PLAYWRIGHT_MODULE apuntando a una instalación existente)
// Uso: npm test              → todas las suites
//      npm test e2e.gastos   → solo las suites cuyo nombre contenga el filtro

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, '.tmp');
const DB = path.join(TMP, 'test.db');
const PORT = process.env.TEST_PORT || 3100;
const BASE = `http://localhost:${PORT}`;

const filtro = process.argv[2] || '';
const suites = fs.readdirSync(__dirname)
  .filter((f) => f.startsWith('e2e.') && f.endsWith('.mjs') && f.includes(filtro))
  .sort();

if (suites.length === 0) {
  console.error(`No hay suites que coincidan con "${filtro}"`);
  process.exit(1);
}

fs.mkdirSync(TMP, { recursive: true });

function limpiarDB() {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB + ext); } catch { /* no existe */ }
  }
}

function esperarSalud(intentos = 40) {
  return new Promise((resolve, reject) => {
    const tick = async (n) => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) return resolve();
      } catch { /* aún no arriba */ }
      if (n <= 0) return reject(new Error('el servidor no arrancó'));
      setTimeout(() => tick(n - 1), 500);
    };
    tick(intentos);
  });
}

function correr(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env }
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let fallos = 0;
for (const suite of suites) {
  console.log(`\n━━━ ${suite} ━━━`);
  limpiarDB();
  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, DB_PATH: DB, PORT: String(PORT) }
  });
  try {
    await esperarSalud();
    const code = await correr('node', [path.join(__dirname, suite)], { BASE_URL: BASE });
    if (code !== 0) fallos++;
    console.log(code === 0 ? `━━━ ${suite}: OK` : `━━━ ${suite}: FALLÓ (exit ${code})`);
  } catch (err) {
    fallos++;
    console.error(`━━━ ${suite}: ${err.message}`);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
}

limpiarDB();
console.log(`\n${suites.length - fallos}/${suites.length} suites OK`);
process.exit(fallos > 0 ? 1 : 0);
