const TOKEN_KEY = 'cf_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
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
