const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { JWT_SECRET } = require('../lib/config');
const { authRequired } = require('../middleware/auth');
const { logEvent } = require('../lib/log');

const router = express.Router();

const findByLogin = db.prepare(`
  SELECT * FROM users
  WHERE lower(username) = lower(?) OR lower(email) = lower(?)
`);
const findById = db.prepare('SELECT * FROM users WHERE id = ?');
const findByUsername = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)');
const findByEmail = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)');

const MAX_AVATAR_CHARS = 400 * 1024; // ~300KB de imagen en base64

function initialsOf(nombre, apellido, name) {
  const a = (nombre || name || '?').trim();
  const b = (apellido || '').trim();
  return ((a[0] || '?') + (b[0] || (a.split(/\s+/)[1]?.[0] ?? ''))).toUpperCase();
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    nombre: u.nombre,
    apellido: u.apellido,
    username: u.username,
    email: u.email,
    phone: u.phone,
    avatar: u.avatar,
    initials: u.initials || initialsOf(u.nombre, u.apellido, u.name),
    role: u.role,
    status: u.status
  };
}

function issueToken(u) {
  return jwt.sign({ sub: u.id, username: u.username, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
}

// Username autogenerado: primera letra del nombre + apellido, sin tildes
function generarUsername(nombre, apellido) {
  const base = (String(nombre).trim()[0] + String(apellido).trim())
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]/g, '');
  let candidato = base || 'usuario';
  let n = 2;
  while (findByUsername.get(candidato)) candidato = `${base}${n++}`;
  return candidato;
}

// ─── Límite de intentos de login (anti fuerza bruta) ───────────
// En memoria, por IP: MAX_INTENTOS fallos dentro de la ventana bloquean
// esa IP por BLOQUEO_MS. Un login correcto limpia el contador. Se purgan
// entradas viejas para que el mapa no crezca sin límite.
const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;
const BLOQUEO_MS = 15 * 60 * 1000;
const intentos = new Map(); // ip → { count, first, blockedUntil }

function checkRateLimit(ip) {
  const now = Date.now();
  if (intentos.size > 5000) {
    for (const [k, v] of intentos) {
      if (now - v.first > VENTANA_MS && (!v.blockedUntil || v.blockedUntil < now)) intentos.delete(k);
    }
  }
  const e = intentos.get(ip);
  if (!e) return null;
  if (e.blockedUntil && e.blockedUntil > now) {
    return Math.ceil((e.blockedUntil - now) / 60000);
  }
  if (now - e.first > VENTANA_MS) intentos.delete(ip);
  return null;
}

function registrarFallo(ip, req) {
  const now = Date.now();
  const e = intentos.get(ip) || { count: 0, first: now, blockedUntil: 0 };
  if (now - e.first > VENTANA_MS) { e.count = 0; e.first = now; }
  e.count++;
  if (e.count >= MAX_INTENTOS) {
    e.blockedUntil = now + BLOQUEO_MS;
    logEvent(null, 'Login bloqueado', `IP ${ip} superó ${MAX_INTENTOS} intentos fallidos`, req);
  }
  intentos.set(ip, e);
}

router.post('/login', (req, res) => {
  const ip = req.ip || 'desconocida';
  const bloqueadoMin = checkRateLimit(ip);
  if (bloqueadoMin !== null) {
    return res.status(429).json({ error: `Demasiados intentos fallidos. Intenta de nuevo en ${bloqueadoMin} minuto(s).` });
  }

  const b = req.body || {};
  const password = String(b.password || '');

  let user = null;
  if (b.pillId) {
    // Login desde una pill: el cliente solo conoce el id
    user = findById.get(Number(b.pillId));
  } else {
    const login = String(b.username || b.email || '').trim();
    if (!login || !password) return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    user = findByLogin.get(login, login);
  }

  if (!user) {
    registrarFallo(ip, req);
    return res.status(401).json({ error: 'Usuario no encontrado' });
  }
  if (user.status === 'pending') return res.status(401).json({ error: 'Cuenta pendiente de aprobación' });
  if (user.status !== 'active') return res.status(401).json({ error: 'Cuenta inactiva' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    registrarFallo(ip, req);
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  intentos.delete(ip);
  logEvent(user.username, 'Login', `Inicio de sesión de ${user.name}`, req);
  res.json({ ok: true, token: issueToken(user), user: publicUser(user) });
});

// Registro público: crea la cuenta en estado 'pending' — requiere
// aprobación del administrador antes de poder entrar (no devuelve token)
router.post('/register', (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim();
  const apellido = String(b.apellido || '').trim();
  const email = String(b.email || '').trim();
  const password = String(b.password || '');

  if (!nombre || !apellido) return res.status(400).json({ error: 'Nombre y apellido son requeridos' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Correo electrónico inválido' });
  if (password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  if (findByEmail.get(email)) return res.status(409).json({ error: 'Ese correo ya está registrado' });

  let avatar = null;
  if (b.avatar) {
    avatar = String(b.avatar);
    if (!avatar.startsWith('data:image/')) return res.status(400).json({ error: 'Avatar inválido' });
    if (avatar.length > MAX_AVATAR_CHARS) return res.status(400).json({ error: 'La foto es muy grande (máximo ~300KB)' });
  }

  const username = generarUsername(nombre, apellido);
  db.prepare(`
    INSERT INTO users (username, password_hash, name, email, phone, avatar, initials, nombre, apellido, role, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 'pending')
  `).run(username, bcrypt.hashSync(password, 10), `${nombre} ${apellido}`, email,
    b.phone ? String(b.phone).trim() : null, avatar, initialsOf(nombre, apellido), nombre, apellido);

  logEvent(username, 'Registro de usuario', `${nombre} ${apellido} <${email}> — pendiente de aprobación`, req);
  res.status(201).json({
    ok: true,
    username,
    message: `¡Cuenta creada! Tu usuario es "${username}". Espera la aprobación del administrador para entrar.`
  });
});

// Pills del login: solo datos de presentación de cuentas activas
// (sin username, email, rol ni estado — privacidad primero)
router.get('/pills', (req, res) => {
  const rows = db.prepare(
    "SELECT id, name, avatar, initials, nombre, apellido FROM users WHERE status = 'active' ORDER BY id"
  ).all();
  res.json(rows.map((u) => ({
    id: u.id,
    name: u.name,
    initials: u.initials || initialsOf(u.nombre, u.apellido, u.name),
    avatar: u.avatar
  })));
});

router.get('/me', authRequired, (req, res) => {
  const user = findById.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Usuario no existe' });
  res.json({ user: publicUser(user) });
});

// ─── Autoservicio de perfil ─────────────────────────────────
// Cualquier usuario activo edita SUS datos de presentación y contacto.
// Rol, estado y username quedan fuera — esos los gestiona el admin.

router.put('/me', authRequired, (req, res) => {
  const u = findById.get(req.user.id);
  if (!u) return res.status(401).json({ error: 'Usuario no existe' });
  const b = req.body || {};

  const nombre = b.nombre !== undefined ? String(b.nombre).trim() : u.nombre;
  const apellido = b.apellido !== undefined ? String(b.apellido).trim() : u.apellido;
  if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
  const name = `${nombre} ${apellido || ''}`.trim();

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

  let avatar = u.avatar;
  if (b.avatar !== undefined) {
    avatar = b.avatar ? String(b.avatar) : null;
    if (avatar && (!avatar.startsWith('data:image/') || avatar.length > MAX_AVATAR_CHARS)) {
      return res.status(400).json({ error: 'Avatar inválido o muy grande (máximo ~300KB)' });
    }
  }

  db.prepare(`
    UPDATE users SET name=?, nombre=?, apellido=?, email=?, phone=?, avatar=?, initials=?
    WHERE id=?
  `).run(name, nombre, apellido, email,
    b.phone !== undefined ? (b.phone ? String(b.phone).trim() : null) : u.phone,
    avatar, initialsOf(nombre, apellido, name), u.id);

  logEvent(req.user.username, 'Perfil actualizado', `${u.username} editó su perfil`, req);
  res.json({ user: publicUser(findById.get(u.id)) });
});

// Cambio de contraseña propio: exige la contraseña actual
router.put('/me/password', authRequired, (req, res) => {
  const u = findById.get(req.user.id);
  if (!u) return res.status(401).json({ error: 'Usuario no existe' });
  const b = req.body || {};
  const actual = String(b.currentPassword || '');
  const nueva = String(b.newPassword || '');

  // 400 y no 401: un 401 en rutas autenticadas significa "sesión expirada"
  // para el cliente (cierra la sesión); esto es un error de formulario
  if (!bcrypt.compareSync(actual, u.password_hash)) {
    return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
  }
  if (nueva.length < 4) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(nueva, 10), u.id);
  logEvent(req.user.username, 'Cambio de contraseña', `${u.username} cambió su propia contraseña`, req);
  res.json({ ok: true });
});

module.exports = router;
module.exports.publicUser = publicUser;
module.exports.generarUsername = generarUsername;
module.exports.initialsOf = initialsOf;
module.exports.MAX_AVATAR_CHARS = MAX_AVATAR_CHARS;
