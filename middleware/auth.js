const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { JWT_SECRET } = require('../lib/config');

const findUser = db.prepare('SELECT id, username, role, status FROM users WHERE id = ?');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Se consulta el estado real en cada petición: si el admin desactiva
    // una cuenta, su token deja de servir al instante
    const user = findUser.get(payload.sub);
    if (!user) return res.status(401).json({ error: 'Usuario no existe' });
    if (user.status !== 'active') return res.status(401).json({ error: 'Cuenta inactiva' });
    req.user = { id: user.id, username: user.username, role: user.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido: solo el administrador' });
  }
  next();
}

module.exports = { authRequired, adminRequired };
