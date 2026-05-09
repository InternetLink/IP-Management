// ============================================================================
// API Client — Connects frontend to NestJS backend
// ============================================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const AUTH_TOKEN_KEY = 'ipam-auth-token';

function isBrowser() {
  return typeof window !== 'undefined';
}

export function getAuthToken() {
  if (!isBrowser()) return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string) {
  if (isBrowser()) localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  if (isBrowser()) localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    if (res.status === 401) {
      clearAuthToken();
      if (isBrowser() && !['/login', '/logout'].includes(window.location.pathname)) {
        window.location.assign('/login');
      }
    }
    throw new Error(error.message || `API Error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  auth: {
    status: () => request<{hasUsers: boolean}>('/auth/status'),
    bootstrap: (data: {username: string; password: string; email?: string}) =>
      request<{token: string; expiresAt: number; user: any}>('/auth/bootstrap', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: {username: string; password: string}) =>
      request<{token: string; expiresAt: number; user: any}>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    me: () => request<any>('/auth/me'),
    changePassword: (data: {currentPassword: string; newPassword: string}) =>
      request<{ok: boolean}>('/auth/password', { method: 'POST', body: JSON.stringify(data) }),
  },

  dashboard: {
    getStats: () => request<any>('/dashboard'),
  },

  prefixes: {
    roots: () => request<any[]>('/prefixes'),
    get: (id: string) => request<any>(`/prefixes/${id}`),
    tree: (id: string) => request<any>(`/prefixes/${id}/tree`),
    create: (data: any) => request<any>('/prefixes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/prefixes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/prefixes/${id}`, { method: 'DELETE' }),
    split: (id: string, newPrefixLength: number) => request<any>(`/prefixes/${id}/split`, { method: 'POST', body: JSON.stringify({ newPrefixLength }) }),
    generateIPs: (id: string) => request<any>(`/prefixes/${id}/generate-ips`, { method: 'POST' }),
    allocations: (id: string, status?: string) => {
      const qs = status && status !== 'all' ? `?status=${status}` : '';
      return request<any[]>(`/prefixes/${id}/allocations${qs}`);
    },
    updateAllocation: (prefixId: string, allocId: string, data: any) =>
      request<any>(`/prefixes/${prefixId}/allocations/${allocId}`, { method: 'PUT', body: JSON.stringify(data) }),
    bulkUpdateAllocations: (prefixId: string, data: any) =>
      request<any>(`/prefixes/${prefixId}/allocations`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  geofeed: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any[]>(`/geofeed${qs}`);
    },
    get: (id: string) => request<any>(`/geofeed/${id}`),
    create: (data: any) => request<any>('/geofeed', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/geofeed/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/geofeed/${id}`, { method: 'DELETE' }),
    import: (csv: string) => request<{ imported: number }>('/geofeed/import', { method: 'POST', body: JSON.stringify({ csv }) }),
    generateUrl: (header?: string, asn?: string) => {
      const params = new URLSearchParams();
      if (header) params.set('header', header);
      if (asn) params.set('asn', asn);
      return `${API_BASE}/geofeed/generate?${params.toString()}`;
    },
  },

  audit: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any[]>(`/audit${qs}`);
    },
  },

  settings: {
    get: () => request<any>('/settings'),
    update: (data: any) => request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },
};
