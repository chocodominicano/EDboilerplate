require('dotenv').config();

const PORT = parseInt(process.env.PORT, 10) || 3000;

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = 'dev-secret-cambiar-en-produccion';
  console.warn('[config] JWT_SECRET no definido en .env — usando clave de desarrollo. NO usar en producción.');
}

module.exports = { PORT, JWT_SECRET };
