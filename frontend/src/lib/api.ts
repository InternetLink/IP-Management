// ============================================================================
// API Client — Connects frontend to NestJS backend
// ============================================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `API Error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
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
