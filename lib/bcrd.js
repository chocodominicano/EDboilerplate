// Intento best-effort de obtener la tasa USD/RD$ del BCRD.
// El BCRD no publica una API JSON estable, así que se raspa la página de
// mercado cambiario y se busca un valor plausible. Cualquier fallo (red,
// proxy, HTML distinto) devuelve null y el caller usa el valor guardado.

const BCRD_URL = 'https://www.bcrd.gob.do/estadisticas/mercado-cambiario';
const TIMEOUT_MS = 5000;

async function fetchBcrdRate() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BCRD_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CentroFinanciero/1.0' }
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Busca cifras tipo 58.50 / 62,35 cerca de menciones de venta/dólar
    const matches = html.match(/\b(5[0-9]|6[0-9]|7[0-5])[.,]\d{2,4}\b/g);
    if (!matches || matches.length === 0) return null;
    const rate = parseFloat(matches[0].replace(',', '.'));
    if (!Number.isFinite(rate) || rate < 30 || rate > 120) return null;
    return rate;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchBcrdRate };
