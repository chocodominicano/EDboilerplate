// Estado global mínimo. Los datos de cada vista se re-fetchean al entrar.
export const state = {
  user: null,
  exchangeRate: { rate: 60, source: 'manual', updatedAt: null }
};
