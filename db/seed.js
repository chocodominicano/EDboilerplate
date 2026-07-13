const bcrypt = require('bcryptjs');

const DEFAULT_USERS = [
  { username: 'Admin', password: 'Admin', name: 'Administrador', email: null, initials: 'AD', role: 'admin' },
  { username: 'demo', password: '1234', name: 'Usuario Demo', email: 'demo@financiero.app', initials: 'UD', role: 'user' }
];

const DEFAULT_CATEGORIES = ['Comida', 'Transporte', 'Servicios', 'Salud', 'Entretenimiento',
  'Educación', 'Hogar', 'Ropa', 'Préstamos', 'Gastos fijos', 'Otros'];

const DEFAULT_PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Débito'];

function seed(db) {
  const insert = db.prepare(`
    INSERT INTO users (username, password_hash, name, email, initials, role, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `);
  const exists = db.prepare('SELECT * FROM users WHERE username = ?');

  for (const u of DEFAULT_USERS) {
    const row = exists.get(u.username);
    if (!row) {
      insert.run(u.username, bcrypt.hashSync(u.password, 10), u.name, u.email, u.initials, u.role);
      console.log(`[seed] Usuario creado: ${u.username} (${u.role})`);
    } else if (!row.email && u.email) {
      // Backfill para DBs migradas de versiones anteriores
      db.prepare('UPDATE users SET email = ?, initials = ? WHERE id = ?').run(u.email, u.initials, row.id);
    }
  }

  // DBs viejas tenían email='Admin' (no era un correo) — se limpia para
  // que la validación de correos no necesite excepciones
  db.prepare("UPDATE users SET email = NULL WHERE email = 'Admin'").run();

  if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
    const ins = db.prepare('INSERT INTO categories (nombre) VALUES (?)');
    for (const c of DEFAULT_CATEGORIES) ins.run(c);
    console.log('[seed] Categorías por defecto creadas');
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM payment_methods').get().n === 0) {
    const ins = db.prepare('INSERT INTO payment_methods (nombre) VALUES (?)');
    for (const m of DEFAULT_PAYMENT_METHODS) ins.run(m);
    console.log('[seed] Métodos de pago por defecto creados');
  }
}

module.exports = { seed };
