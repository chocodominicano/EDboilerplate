const db = require('../db/database');

const insert = db.prepare('INSERT INTO system_logs (user, event, detail, ip) VALUES (?, ?, ?, ?)');

// Registro de actividad del sistema: logins, registros, aprobaciones,
// cambios de rol/estado/contraseña, eliminaciones, cambios de catálogos.
function logEvent(user, event, detail, req) {
  try {
    insert.run(user || 'sistema', event, detail || null, (req && req.ip) || null);
  } catch {
    // el log nunca debe tumbar la operación principal
  }
}

module.exports = { logEvent };
