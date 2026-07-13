// Estado global mínimo. Los datos de cada vista se re-fetchean al entrar.
// exchangeRate espeja DEFAULT_EXCHANGE_RATE de lib/settings.js (servidor):
// es el ÚNICO default del cliente y solo se usa hasta que /api/exchange-rate
// responde al entrar a la app — no duplicar este valor en las vistas.
export const state = {
  user: null,
  exchangeRate: { rate: 60, source: 'manual', updatedAt: null }
};
