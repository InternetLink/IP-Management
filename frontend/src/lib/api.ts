import {
  parseAllocation,
  parseAllocationHeatmap,
  parseAllocationList,
  parseAllocationStatusCounts,
  parseAuditList,
  parseAuthStatus,
  parseAuthUser,
  parseBulkAllocationUpdate,
  parseDeletedResponse,
  parseGenerateIPs,
  parseGeofeedEntry,
  parseGeofeedImport,
  parseGeofeedPage,
  parseLoginResponse,
  parseOkResponse,
  parsePrefixDetail,
  parsePrefixList,
  parsePrefixRecord,
  parsePrefixSplit,
  parsePrefixTree,
  parseVoid,
} from "./api-parsers";
import {parseDashboardStats, parseSettings} from "./api-parsers-dashboard";
import { type AllocationQueryParams, type AllocationUpdateInput, ApiClientError, ApiPayloadError, type AuditQueryParams, type BulkAllocationUpdateInput, type GeofeedCreateInput, type GeofeedQueryParams, type GeofeedUpdateInput, type PrefixCreateInput, type PrefixQueryParams, type PrefixUpdateInput, type SettingsUpdateInput } from './api-types';

export {ApiClientError, ApiPayloadError, parseDecimalString} from "./api-types";
export type {
  Allocation,
  AllocationHeatmap,
  AllocationPage,
  AllocationPurpose,
  AllocationStatus,
  ApiAuthUser,
  AuditEntry,
  DashboardStats,
  DecimalString,
  GeofeedEntry,
  GeofeedImportError,
  GeofeedImportResponse,
  GeofeedPage,
  PrefixPage,
  PrefixDetailResponse,
  PrefixCreateInput,
  PrefixRecord,
  PrefixSplitResponse,
  PrefixTreeNode,
  PrefixUpdateInput,
  SettingsResponse,
} from "./api-types";

const API_BASE = "/api";
const CSRF_HEADER_NAME = "x-csrf-token";

type ResponseParser<T> = (value: unknown) => T;

type RequestOptions = Omit<RequestInit, "signal"> & {
  readonly signal?: AbortSignal;
};

function isBrowser() {
  return typeof window !== "undefined";
}

function csrfCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-ipam_csrf" : "ipam_csrf";
}

function readCookie(name: string) {
  if (!isBrowser()) return null;
  const encodedName = `${encodeURIComponent(name)}=`;
  const entry = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(encodedName));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(encodedName.length));
  } catch {
    return null;
  }
}

function isMutation(method: string) {
  return method !== "GET" && method !== "HEAD";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetails(payload: unknown, fallback: string) {
  if (!isJsonObject(payload)) return {code: null, message: fallback};
  const rawMessage = payload.message;
  const message = typeof rawMessage === "string"
    ? rawMessage
    : Array.isArray(rawMessage) && rawMessage.every((item) => typeof item === "string")
      ? rawMessage.join("; ")
      : fallback;
  return {code: typeof payload.code === "string" ? payload.code : null, message};
}

async function request<T>(path: string, parser: ResponseParser<T>, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (isMutation(method)) {
    const csrfToken = readCookie(csrfCookieName());
    if (csrfToken) headers.set(CSRF_HEADER_NAME, csrfToken);
  }

  const response = await fetch(`${API_BASE}${path}`, {...options, credentials: "same-origin", headers, method});
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = (await response.json()) as unknown;
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
    if (response.status === 401 && isBrowser() && !["/login", "/logout"].includes(window.location.pathname)) {
      window.location.assign("/login");
    }
    const fallback = response.statusText || `API Error ${response.status}`;
    const details = errorDetails(payload, fallback);
    throw new ApiClientError(details.message, response.status, details.code, "http", payload);
  }
  if (response.status === 204) return parser(undefined);
  try {
    return parser((await response.json()) as unknown);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiPayloadError) throw error;
    throw new ApiPayloadError(path, "expected a valid JSON response body");
  }
}

function readOptions(signal?: AbortSignal): RequestOptions {
  return signal ? {signal} : {};
}

function queryString<T extends object>(params?: T) {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number") search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

export const api = {
  auth: {
    status: (signal?: AbortSignal) => request("/auth/status", parseAuthStatus, readOptions(signal)),
    login: async (data: {readonly username: string; readonly password: string}) => {
      await request("/auth/login", parseVoid);
      return request("/auth/login", parseLoginResponse, {method: "POST", body: JSON.stringify(data)});
    },
    logout: () => request("/auth/logout", parseOkResponse, {method: "POST"}),
    me: (signal?: AbortSignal) => request("/auth/me", parseAuthUser, readOptions(signal)),
    changePassword: (data: {readonly currentPassword: string; readonly newPassword: string}) =>
      request("/auth/password", parseOkResponse, {method: "POST", body: JSON.stringify(data)}),
  },

  dashboard: {
    getStats: (signal?: AbortSignal) => request("/dashboard", parseDashboardStats, readOptions(signal)),
  },

  prefixes: {
    roots: (params?: PrefixQueryParams, signal?: AbortSignal) => request(`/prefixes${queryString(params)}`, parsePrefixList, readOptions(signal)),
    get: (id: string, signal?: AbortSignal) => request(`/prefixes/${id}`, parsePrefixDetail, readOptions(signal)),
    tree: (id: string, signal?: AbortSignal) => request(`/prefixes/${id}/tree`, parsePrefixTree, readOptions(signal)),
    create: (data: PrefixCreateInput) => request("/prefixes", parsePrefixRecord, {method: "POST", body: JSON.stringify(data)}),
    update: (id: string, data: PrefixUpdateInput) => request(`/prefixes/${id}`, parsePrefixRecord, {method: "PUT", body: JSON.stringify(data)}),
    delete: (id: string) => request(`/prefixes/${id}`, parseDeletedResponse, {method: "DELETE"}),
    split: (id: string, newPrefixLength: number) => request(`/prefixes/${id}/split`, parsePrefixSplit, {method: "POST", body: JSON.stringify({newPrefixLength})}),
    generateIPs: (id: string) => request(`/prefixes/${id}/generate-ips`, parseGenerateIPs, {method: "POST"}),
    allocations: (id: string, params?: AllocationQueryParams, signal?: AbortSignal) =>
      request(`/prefixes/${id}/allocations${queryString(params)}`, parseAllocationList, readOptions(signal)),
    allocationStatusCounts: (id: string, signal?: AbortSignal) =>
      request(`/prefixes/${id}/allocations/status-counts`, parseAllocationStatusCounts, readOptions(signal)),
    allocationHeatmap: (id: string, signal?: AbortSignal) =>
      request(`/prefixes/${id}/allocations/heatmap`, parseAllocationHeatmap, readOptions(signal)),
    updateAllocation: (prefixId: string, allocationId: string, data: AllocationUpdateInput) =>
      request(`/prefixes/${prefixId}/allocations/${allocationId}`, parseAllocation, {method: "PUT", body: JSON.stringify(data)}),
    bulkUpdateAllocations: (prefixId: string, data: BulkAllocationUpdateInput) =>
      request(`/prefixes/${prefixId}/allocations`, parseBulkAllocationUpdate, {method: "PUT", body: JSON.stringify(data)}),
  },

  geofeed: {
    list: (params?: GeofeedQueryParams, signal?: AbortSignal) => request(`/geofeed${queryString(params)}`, parseGeofeedPage, readOptions(signal)),
    get: (id: string, signal?: AbortSignal) => request(`/geofeed/${id}`, parseGeofeedEntry, readOptions(signal)),
    create: (data: GeofeedCreateInput) => request("/geofeed", parseGeofeedEntry, {method: "POST", body: JSON.stringify(data)}),
    update: (id: string, data: GeofeedUpdateInput) => request(`/geofeed/${id}`, parseGeofeedEntry, {method: "PUT", body: JSON.stringify(data)}),
    delete: (id: string) => request(`/geofeed/${id}`, parseDeletedResponse, {method: "DELETE"}),
    import: (csv: string) => request("/geofeed/import", parseGeofeedImport, {method: "POST", body: JSON.stringify({csv})}),
    generateUrl: (header?: string, asn?: string) => {
      const params = new URLSearchParams();
      if (header) params.set("header", header);
      if (asn) params.set("asn", asn);
      return `${API_BASE}/geofeed/generate?${params.toString()}`;
    },
  },

  audit: {
    list: (params?: AuditQueryParams, signal?: AbortSignal) => request(`/audit${queryString(params)}`, parseAuditList, readOptions(signal)),
  },

  settings: {
    get: (signal?: AbortSignal) => request("/settings", parseSettings, readOptions(signal)),
    update: (data: SettingsUpdateInput) => request("/settings", parseSettings, {method: "PUT", body: JSON.stringify(data)}),
  },
};
