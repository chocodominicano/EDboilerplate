const bcrypt = require('bcryptjs');

const DEFAULT_USERS = [
  { username: 'Admin', password: 'Admin', name: 'Administrador', role: 'admin' },
  { username: 'demo', password: '1234', name: 'Usuario Demo', role: 'user' }
];

function seed(db) {
  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)'
  );
  const exists = db.prepare('SELECT id FROM users WHERE username = ?');

  for (const u of DEFAULT_USERS) {
    if (!exists.get(u.username)) {
      insert.run(u.username, bcrypt.hashSync(u.password, 10), u.name, u.role);
      console.log(`[seed] Usuario creado: ${u.username} (${u.role})`);
    }
  }
}

module.exports = { seed };
