// Máscara de monto con separadores de miles mientras se escribe (1,234.56).
// Reutilizable en cualquier <input type="text">.

function formatWhileTyping(raw) {
  let s = String(raw).replace(/[^0-9.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    // deja solo el primer punto decimal
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }
  if (s === '' || s === '.') return s === '.' ? '0.' : '';

  let [intPart, decPart] = s.split('.');
  intPart = intPart.replace(/^0+(?=\d)/, '') || '0';
  const intFmt = Number(intPart).toLocaleString('en-US');
  if (s.indexOf('.') === -1) return intFmt;
  return `${intFmt}.${(decPart || '').slice(0, 2)}`;
}

export function moneyToNum(input) {
  const s = String((input && input.value) ?? input ?? '').replace(/,/g, '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// Número → "1,234.56" para pre-poblar campos al editar
export function moneyStr(num) {
  return Number(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Conecta el formato en vivo a un input, preservando la posición del cursor
export function attachMoney(input) {
  if (!input || input.dataset.moneyBound) return;
  input.dataset.moneyBound = 'true';
  input.setAttribute('inputmode', 'decimal');
  input.addEventListener('input', () => {
    const raw = input.value;
    const caret = input.selectionStart ?? raw.length;
    // Cuenta dígitos Y el punto decimal antes del cursor (no solo dígitos):
    // si el usuario acaba de escribir '.', debe contar para que el cursor
    // quede DESPUÉS del punto y no antes — si no, los dígitos que siguen
    // se insertan en la parte entera en vez de en los decimales
    // (ej. "49.99" terminaba como "4999").
    const charsBefore = raw.slice(0, caret).replace(/[^0-9.]/g, '').length;
    const formatted = formatWhileTyping(raw);
    input.value = formatted;
    let pos = 0;
    let seen = 0;
    while (pos < formatted.length && seen < charsBefore) {
      if (/[0-9.]/.test(formatted[pos])) seen++;
      pos++;
    }
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      /* algunos navegadores no permiten setSelectionRange en ciertos estados */
    }
  });
}
