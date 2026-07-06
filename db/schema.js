function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      cat TEXT,
      metodo TEXT,
      monto_num REAL NOT NULL CHECK(monto_num >= 0),
      moneda TEXT NOT NULL DEFAULT 'RD$' CHECK(moneda IN ('RD$','USD$')),
      neg INTEGER NOT NULL DEFAULT 1,
      is_pago_tarjeta INTEGER NOT NULL DEFAULT 0,
      is_pago_prestamo INTEGER NOT NULL DEFAULT 0,
      fecha_sort TEXT NOT NULL,
      quincena INTEGER CHECK(quincena IN (1,2)),
      fuente TEXT,
      cuenta TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      icon TEXT,
      icon_bg TEXT,
      cc_key TEXT,
      cc_is_usd INTEGER NOT NULL DEFAULT 0,
      loan_id INTEGER,
      fixed_expense_id INTEGER,
      fixed_income_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user_fecha ON transactions(user_id, fecha_sort);

    CREATE TABLE IF NOT EXISTS credit_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      bank TEXT,
      red TEXT,
      producto TEXT,
      limit_rd REAL NOT NULL DEFAULT 0,
      used_rd REAL NOT NULL DEFAULT 0,
      limit_usd REAL NOT NULL DEFAULT 0,
      used_usd REAL NOT NULL DEFAULT 0,
      doble_saldo INTEGER NOT NULL DEFAULT 0,
      tasa_interes REAL NOT NULL DEFAULT 60,
      alerta_rd REAL,
      dia_corte INTEGER NOT NULL CHECK(dia_corte BETWEEN 1 AND 31),
      dia_pago INTEGER NOT NULL CHECK(dia_pago BETWEEN 1 AND 31),
      pago_minimo_pct REAL NOT NULL DEFAULT 5,
      activo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, key)
    );

    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      banco TEXT,
      original REAL NOT NULL CHECK(original > 0),
      tasa_anual REAL NOT NULL DEFAULT 0,
      plazo_meses INTEGER NOT NULL CHECK(plazo_meses > 0),
      cuota_mensual REAL NOT NULL,
      dia_pago INTEGER NOT NULL CHECK(dia_pago BETWEEN 1 AND 31),
      fecha_inicio TEXT NOT NULL,
      saldo_pendiente REAL NOT NULL,
      cuotas_pagadas INTEGER NOT NULL DEFAULT 0,
      activo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fixed_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      concepto TEXT NOT NULL,
      monto REAL NOT NULL CHECK(monto >= 0),
      dia INTEGER NOT NULL CHECK(dia BETWEEN 1 AND 31),
      cat TEXT,
      metodo TEXT,
      pagados_meses TEXT NOT NULL DEFAULT '[]',
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS fixed_incomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      descripcion TEXT NOT NULL,
      monto REAL NOT NULL CHECK(monto >= 0),
      dia INTEGER NOT NULL CHECK(dia BETWEEN 1 AND 31),
      cuenta TEXT,
      activo INTEGER NOT NULL DEFAULT 1,
      recibidos_meses TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cat TEXT NOT NULL,
      monto REAL NOT NULL CHECK(monto >= 0),
      UNIQUE(user_id, cat)
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY(user_id, key)
    );
  `);
}

module.exports = { createTables };
