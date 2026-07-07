const path = require('path');
const Database = require('better-sqlite3');
const { createTables, migrate } = require('./schema');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'financiero.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// El schema se crea/migra aquí para que cualquier módulo que haga
// require de la DB pueda preparar sus consultas de inmediato.
createTables(db);
migrate(db);

module.exports = db;
