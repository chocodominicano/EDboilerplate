require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 3000;

// Prioridad: JWT_SECRET del entorno/.env. Si no existe, se genera un
// secreto aleatorio la PRIMERA vez y se persiste en .jwt-secret (junto a
// la DB) para que las sesiones sobrevivan reinicios. Nunca un valor fijo
// conocido: un secreto predecible permite falsificar tokens.
const SECRET_PATH = process.env.JWT_SECRET_PATH || path.join(__dirname, '..', '.jwt-secret');

function loadOrCreateSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    const saved = fs.readFileSync(SECRET_PATH, 'utf8').trim();
    if (saved) return saved;
  } catch {
    /* no existe todavía */
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, secret + '\n', { mode: 0o600 });
  console.log(`[config] JWT_SECRET generado y guardado en ${SECRET_PATH}`);
  return secret;
}

const JWT_SECRET = loadOrCreateSecret();

module.exports = { PORT, JWT_SECRET };
