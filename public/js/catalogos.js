// Fallback de catálogos para cuando /api/catalog no responde.
// La fuente de verdad son las tablas categories/payment_methods
// (administrables desde el panel admin); estas listas solo evitan
// formularios vacíos sin conexión y espejan db/seed.js.

export const DEFAULT_CATEGORIAS = ['Comida', 'Transporte', 'Servicios', 'Salud', 'Entretenimiento',
  'Educación', 'Hogar', 'Ropa', 'Préstamos', 'Gastos fijos', 'Otros'];

export const DEFAULT_METODOS = ['Efectivo', 'Transferencia', 'Débito'];
