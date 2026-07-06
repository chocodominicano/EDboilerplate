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

  if (res.status === 401) {
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
