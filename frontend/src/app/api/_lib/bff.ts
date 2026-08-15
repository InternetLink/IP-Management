import {randomBytes, randomUUID, timingSafeEqual} from "node:crypto";

import {type NextRequest, NextResponse} from "next/server";

export const CSRF_HEADER_NAME = "x-csrf-token";
export const REQUEST_ID_HEADER_NAME = "x-request-id";

const DEFAULT_APP_ORIGIN = "http://localhost:3003";
const SAFE_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "range",
] as const;
const SAFE_RESPONSE_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-type",
  "etag",
  "last-modified",
  "retry-after",
  "vary",
] as const;
const SAFE_METHODS = new Set(["GET", "HEAD"]);

type CookieOptions = {
  httpOnly: boolean;
  path: "/";
  sameSite: "lax";
  secure: boolean;
};

type AuthCookie = {
  name: string;
  options: CookieOptions;
};

type AuthCookieConfig = {
  csrf: AuthCookie;
  session: AuthCookie;
};

type BackendRequestOptions = {
  includeSession?: boolean;
  requestId?: string;
  search?: string;
};

export function getAuthCookieConfig(isProduction = process.env.NODE_ENV === "production"): AuthCookieConfig {
  const prefix = isProduction ? "__Host-" : "";
  const secure = isProduction;
  const shared = {path: "/", sameSite: "lax", secure} as const;

  return {
    csrf: {
      name: `${prefix}ipam_csrf`,
      options: {...shared, httpOnly: false},
    },
    session: {
      name: `${prefix}ipam_session`,
      options: {...shared, httpOnly: true},
    },
  };
}

function canonicalOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!(["http:", "https:"] as const).includes(parsed.protocol as "http:" | "https:")) return null;
    return parsed.origin === value ? value : null;
  } catch {
    return null;
  }
}

export function getAllowedBrowserOrigins(value = process.env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN): readonly string[] {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0 || origins.some((origin) => canonicalOrigin(origin) === null)) {
    throw new Error("APP_ORIGIN must contain comma-separated exact HTTP(S) origins");
  }
  return [...new Set(origins)];
}

function csrfMatches(cookieValue: string | undefined, headerValue: string | null): boolean {
  if (!cookieValue || !headerValue) return false;
  const cookie = Buffer.from(cookieValue);
  const header = Buffer.from(headerValue);
  return cookie.length === header.length && timingSafeEqual(cookie, header);
}

function forbidden(): NextResponse {
  return NextResponse.json(
    {message: "Browser mutation rejected"},
    {headers: {"cache-control": "no-store"}, status: 403},
  );
}

export function validateBrowserMutation(request: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  const {csrf} = getAuthCookieConfig();
  if (!csrfMatches(request.cookies.get(csrf.name)?.value, request.headers.get(CSRF_HEADER_NAME))) {
    return forbidden();
  }

  let allowedOrigins: readonly string[];
  try {
    allowedOrigins = getAllowedBrowserOrigins();
  } catch {
    return NextResponse.json(
      {message: "BFF origin allowlist is invalid"},
      {headers: {"cache-control": "no-store"}, status: 500},
    );
  }

  const origin = request.headers.get("origin");
  if (origin !== null) return allowedOrigins.includes(origin) ? null : forbidden();

  const referer = request.headers.get("referer");
  if (referer === null) return forbidden();
  try {
    return allowedOrigins.includes(new URL(referer).origin) ? null : forbidden();
  } catch {
    return forbidden();
  }
}

export function getSessionToken(request: NextRequest): string | null {
  const {session} = getAuthCookieConfig();
  return request.cookies.get(session.name)?.value ?? null;
}

export function createRequestId(): string {
  return randomUUID();
}

export function buildBackendHeaders(
  request: NextRequest,
  includeSession = true,
  requestId = createRequestId(),
): Headers {
  const headers = new Headers();
  for (const name of SAFE_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  if (includeSession) {
    const token = getSessionToken(request);
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  headers.set(REQUEST_ID_HEADER_NAME, requestId);
  return headers;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getBackendBaseUrl(): string {
  const explicit = process.env.API_PROXY_TARGET?.trim();
  const publicUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  const raw = explicit || (publicUrl && /^https?:\/\//.test(publicUrl) ? publicUrl : "http://127.0.0.1:3001");
  const withoutApi = stripTrailingSlash(raw).replace(/\/api$/, "");
  const parsed = new URL(withoutApi);
  if (!(["http:", "https:"] as const).includes(parsed.protocol as "http:" | "https:")) {
    throw new Error("API proxy target must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("API proxy target must be a credential-free base URL");
  }
  return stripTrailingSlash(parsed.toString());
}

export async function fetchBackend(
  request: NextRequest,
  path: string,
  options: BackendRequestOptions = {},
): Promise<Response> {
  const method = request.method.toUpperCase();
  const requestId = options.requestId ?? createRequestId();
  const init: RequestInit = {
    cache: "no-store",
    headers: buildBackendHeaders(request, options.includeSession ?? true, requestId),
    method,
    redirect: "manual",
  };
  if (!SAFE_METHODS.has(method)) init.body = await request.arrayBuffer();

  return fetch(`${getBackendBaseUrl()}/api/${path}${options.search ?? ""}`, init);
}

export function copySafeResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setCsrfCookie(response: NextResponse, expires: Date): void {
  const {csrf} = getAuthCookieConfig();
  response.cookies.set({name: csrf.name, value: newCsrfToken(), ...csrf.options, expires});
}

export function setAuthenticatedCookies(
  response: NextResponse,
  sessionToken: string,
  expiresAtSeconds: number,
): void {
  const expires = new Date(expiresAtSeconds * 1000);
  const {session} = getAuthCookieConfig();
  response.cookies.set({name: session.name, value: sessionToken, ...session.options, expires});
  setCsrfCookie(response, expires);
}

export function clearAuthCookies(response: NextResponse): void {
  const config = getAuthCookieConfig();
  for (const cookie of [config.session, config.csrf]) {
    response.cookies.set({
      name: cookie.name,
      value: "",
      ...cookie.options,
      expires: new Date(0),
      maxAge: 0,
    });
  }
}
