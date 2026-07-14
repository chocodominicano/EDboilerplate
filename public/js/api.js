const TOKEN_KEY = 'cf_token';

// sessionStorage: el token se borra al cerrar el navegador — más seguro
// en dispositivo compartido (decisión de diseño del documento del login)
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY); // limpia sesiones viejas de localStorage
}

async function request(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  // Un 401 de login/registro es un error normal del formulario (credenciales
  // inválidas); solo los 401 de rutas autenticadas significan sesión expirada.
  const isAuthAttempt = url.startsWith('/api/auth/login') || url.startsWith('/api/auth/register');
  if (res.status === 401 && !isAuthAttempt) {
    // Sesión expirada: limpiar token PRIMERO y volver al login
    clearToken();
    window.dispatchEvent(new Event('cf:unauthorized'));
    throw new Error('Sesión expirada');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

export const apiGet = (url) => request('GET', url);
export const apiPost = (url, body) => request('POST', url, body);
export const apiPut = (url, body) => request('PUT', url, body);
export const apiDelete = (url) => request('DELETE', url);

// Descarga binaria (PDF/Excel) con el mismo Authorization que el resto de
// la API — un <a href> plano no puede llevar el header, así que se trae
// como blob y se dispara la descarga con un enlace temporal.
export async function apiDownload(url, filename) {
  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
