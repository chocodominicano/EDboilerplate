const db = require('../db/database');

const getStmt = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?');
const setStmt = db.prepare(`
  INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
  ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
`);

const DEFAULT_EXCHANGE_RATE = { rate: 60.0, source: 'manual', updatedAt: null };

function getSetting(userId, key, fallback = null) {
  const row = getStmt.get(userId, key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function setSetting(userId, key, value) {
  setStmt.run(userId, key, JSON.stringify(value));
}

function getExchangeRate(userId) {
  return getSetting(userId, 'exchange_rate', DEFAULT_EXCHANGE_RATE);
}

module.exports = { getSetting, setSetting, getExchangeRate, DEFAULT_EXCHANGE_RATE };
