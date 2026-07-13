const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { adminRequired } = require('../middleware/auth');
const { logEvent } = require('../lib/log');
const { publicUser, generarUsername, initialsOf, MAX_AVATAR_CHARS } = require('./auth');

const router = express.Router();
router.use(adminRequired);

const findById = db.prepare('SELECT * FROM users WHERE id = ?');

// ─── Usuarios ───────────────────────────────────────────────

router.get('/users', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id').all();
  res.json(rows.map((u) => ({ ...publicUser(u), createdAt: u.created_at })));
});

// Alta directa desde el panel (sin flujo de aprobación)
router.post('/users', (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim();
  const apellido = String(b.apellido || '').trim();
  const password = String(b.password || '');
  if (!nombre || !apellido) return res.status(400).json({ error: 'Nombre y apellido son requeridos' });
  if (password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });

  const email = b.email ? String(b.email).trim() : null;
  if (email && db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email)) {
    return res.status(409).json({ error: 'Ese correo ya está registrado' });
  }
  const role = b.role === 'admin' ? 'admin' : 'user';
  const status = ['active', 'pending', 'inactive'].includes(b.status) ? b.status : 'active';
  const username = generarUsername(nombre, apellido);

  const info = db.prepare(`
    INSERT INTO users (username, password_hash, name, email, phone, initials, nombre, apellido, role, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(username, bcrypt.hashSync(password, 10), `${nombre} ${apellido}`, email,
    b.phone ? String(b.phone).trim() : null, initialsOf(nombre, apellido), nombre, apellido, role, status);

  logEvent(req.user.username, 'Usuario creado', `${nombre} ${apellido} (${username}) rol=${role}`, req);
  res.status(201).json(publicUser(findById.get(info.lastInsertRowid)));
});

// Edición parcial: datos, acceso, rol y estado — con protecciones reales
router.put('/users/:id', (req, res) => {
  const u = findById.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no existe' });
  const b = req.body || {};
  const isMe = u.id === req.user.id;

  if (isMe && b.role !== undefined && b.role !== u.role) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
  }
  if (isMe && b.status !== undefined && b.status !== u.status) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio estado' });
  }

  const nombre = b.nombre !== undefined ? String(b.nombre).trim() : u.nombre;
  const apellido = b.apellido !== undefined ? String(b.apellido).trim() : u.apellido;
  let name = b.name !== undefined ? String(b.name).trim() : u.name;
  if ((b.nombre !== undefined || b.apellido !== undefined) && b.name === undefined) {
    name = `${nombre || ''} ${apellido || ''}`.trim() || u.name;
  }
  if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

  let email = u.email;
  if (b.email !== undefined) {
    email = b.email ? String(b.email).trim() : null;
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Correo electrónico inválido' });
      }
      const dup = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?').get(email, u.id);
      if (dup) return res.status(409).json({ error: 'Ese correo ya está en uso por otro usuario' });
    }
  }

  let username = u.username;
  if (b.username !== undefined) {
    username = String(b.username).trim();
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) {
      return res.status(400).json({ error: 'El usuario debe tener 3-30 caracteres (letras, números, punto, guion)' });
    }
    const dup = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?').get(username, u.id);
    if (dup) return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
  }

  const role = b.role !== undefined ? (b.role === 'admin' ? 'admin' : 'user') : u.role;
  const status = b.status !== undefined
    ? (['active', 'pending', 'inactive'].includes(b.status) ? b.status : u.status)
    : u.status;

  let avatar = u.avatar;
  if (b.avatar !== undefined) {
    avatar = b.avatar ? String(b.avatar) : null;
    if (avatar && (!avatar.startsWith('data:image/') || avatar.length > MAX_AVATAR_CHARS)) {
      return res.status(400).json({ error: 'Avatar inválido o muy grande (máximo ~300KB)' });
    }
  }

  db.prepare(`
    UPDATE users SET name=?, nombre=?, apellido=?, email=?, phone=?, username=?, role=?, status=?, avatar=?, initials=?
    WHERE id=?
  `).run(name, nombre, apellido, email,
    b.phone !== undefined ? (b.phone ? String(b.phone).trim() : null) : u.phone,
    username, role, status, avatar, initialsOf(nombre, apellido, name), u.id);

  if (role !== u.role) logEvent(req.user.username, 'Cambio de rol', `${username}: ${u.role} → ${role}`, req);
  if (status !== u.status) logEvent(req.user.username, 'Cambio de estado', `${username}: ${u.status} → ${status}`, req);

  res.json(publicUser(findById.get(u.id)));
});

router.put('/users/:id/password', (req, res) => {
  const u = findById.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no existe' });
  const password = String((req.body || {}).password || '');
  if (password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), u.id);
  logEvent(req.user.username, 'Cambio de contraseña', `Contraseña actualizada para ${u.username}`, req);
  res.json({ ok: true });
});

router.post('/users/:id/approve', (req, res) => {
  const u = findById.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no existe' });
  if (u.status === 'active') return res.status(400).json({ error: 'La cuenta ya está activa' });

  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(u.id);
  logEvent(req.user.username, 'Aprobación', `Cuenta aprobada: ${u.username} <${u.email || ''}>`, req);
  res.json(publicUser(findById.get(u.id)));
});

// Eliminar usuario: borra en cascada TODOS sus datos financieros
router.delete('/users/:id', (req, res) => {
  const u = findById.get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Usuario no existe' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  if (u.role === 'admin') return res.status(400).json({ error: 'No se puede eliminar a otro administrador' });

  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  logEvent(req.user.username, 'Usuario eliminado', `${u.username} <${u.email || ''}> y todos sus datos`, req);
  res.json({ ok: true });
});

// ─── Logs del sistema ───────────────────────────────────────

router.get('/logs', (req, res) => {
  let limit = Number(req.query.limit);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) limit = 200;
  res.json(db.prepare('SELECT * FROM system_logs ORDER BY id DESC LIMIT ?').all(limit));
});

// ─── Catálogos: categorías y métodos de pago ────────────────

function catalogRoutes(table, label) {
  router.get(`/${table}`, (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY nombre`).all());
  });

  router.post(`/${table}`, (req, res) => {
    const nombre = String((req.body || {}).nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    try {
      const info = db.prepare(`INSERT INTO ${table} (nombre) VALUES (?)`).run(nombre);
      logEvent(req.user.username, `${label} creada`, nombre, req);
      res.status(201).json({ id: info.lastInsertRowid, nombre });
    } catch {
      res.status(409).json({ error: `Ya existe: ${nombre}` });
    }
  });

  router.put(`/${table}/:id`, (req, res) => {
    const nombre = String((req.body || {}).nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    const prev = db.prepare(`SELECT nombre FROM ${table} WHERE id = ?`).get(Number(req.params.id));
    if (!prev) return res.status(404).json({ error: 'No existe' });
    try {
      db.prepare(`UPDATE ${table} SET nombre = ? WHERE id = ?`).run(nombre, Number(req.params.id));
      if (prev.nombre !== nombre) logEvent(req.user.username, `${label} renombrada`, `${prev.nombre} → ${nombre}`, req);
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: `Ya existe: ${nombre}` });
    }
  });

  router.delete(`/${table}/:id`, (req, res) => {
    const row = db.prepare(`SELECT nombre FROM ${table} WHERE id = ?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'No existe' });
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id));
    logEvent(req.user.username, `${label} eliminada`, row.nombre, req);
    res.json({ ok: true });
  });
}

catalogRoutes('categories', 'Categoría');
catalogRoutes('payment_methods', 'Método de pago');

module.exports = router;
