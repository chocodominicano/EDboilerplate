const path = require('path');
const express = require('express');
const { PORT } = require('./lib/config');
const db = require('./db/database');
const { createTables } = require('./db/schema');
const { seed } = require('./db/seed');
const { authRequired } = require('./middleware/auth');

createTables(db);
seed(db);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/transactions', authRequired, require('./routes/transactions'));
app.use('/api/cards', authRequired, require('./routes/cards'));
app.use('/api/loans', authRequired, require('./routes/loans'));
app.use('/api', authRequired, require('./routes/fixed'));
app.use('/api/budgets', authRequired, require('./routes/budgets'));
app.use('/api', authRequired, require('./routes/summary'));
app.use('/api', authRequired, require('./routes/settings'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`Centro Financiero corriendo en http://localhost:${PORT}`);
});
