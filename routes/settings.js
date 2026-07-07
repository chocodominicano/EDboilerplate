const express = require('express');
const db = require('../db/database');
const { getSetting, setSetting, getExchangeRate } = require('../lib/settings');
const { fetchBcrdRate } = require('../lib/bcrd');

const router = express.Router();

// Catálogos para los formularios (cualquier usuario autenticado)
router.get('/catalog', (req, res) => {
  res.json({
    categories: db.prepare('SELECT nombre FROM categories ORDER BY nombre').all().map((r) => r.nombre),
    paymentMethods: db.prepare('SELECT nombre FROM payment_methods ORDER BY nombre').all().map((r) => r.nombre)
  });
});

router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(req.user.id);
  const out = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = null;
    }
  }
  res.json(out);
});

router.put('/settings/:key', (req, res) => {
  const key = String(req.params.key);
  if (!/^[a-z0-9_.-]{1,64}$/i.test(key)) return res.status(400).json({ error: 'key inválida' });
  setSetting(req.user.id, key, (req.body || {}).value ?? null);
  res.json({ ok: true, [key]: getSetting(req.user.id, key) });
});

router.get('/exchange-rate', (req, res) => {
  res.json(getExchangeRate(req.user.id));
});

router.put('/exchange-rate', (req, res) => {
  const rate = Number((req.body || {}).rate);
  if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ error: 'rate debe ser un número mayor que 0' });
  const value = { rate, source: 'manual', updatedAt: new Date().toISOString() };
  setSetting(req.user.id, 'exchange_rate', value);
  res.json(value);
});

// Intenta BCRD; si falla devuelve el valor guardado con fetchError:true
router.post('/exchange-rate/refresh', async (req, res) => {
  const fetched = await fetchBcrdRate();
  if (fetched) {
    const value = { rate: fetched, source: 'bcrd', updatedAt: new Date().toISOString() };
    setSetting(req.user.id, 'exchange_rate', value);
    return res.json(value);
  }
  res.json({ ...getExchangeRate(req.user.id), fetchError: true });
});

module.exports = router;
