const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { JWT_SECRET } = require('../lib/config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
const findUserById = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?');

router.post('/login', (req, res) => {
  const { username, email, password } = req.body || {};
  const login = username || email; // el doc original usaba "email" como campo de login
  if (!login || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }
  const user = findUser.get(String(login));
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role }
  });
});

router.get('/me', authRequired, (req, res) => {
  const user = findUserById.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Usuario no existe' });
  res.json({ user });
});

module.exports = router;
