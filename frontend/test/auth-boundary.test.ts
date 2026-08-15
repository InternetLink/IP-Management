import {NextRequest} from "next/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {GET as prepareLogin, POST as login} from "../src/app/api/auth/login/route";
import {POST as logout} from "../src/app/api/auth/logout/route";
import {GET as me} from "../src/app/api/auth/me/route";
import {GET as proxyGet, POST as proxyPost} from "../src/app/api/[...path]/route";
import {getAuthCookieConfig} from "../src/app/api/_lib/bff";

const APP_ORIGIN = "http://localhost:3003";
const CSRF_TOKEN = "csrf-token";
const SESSION_TOKEN = "server-session-token";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {getSetCookie?: () => string[]};
  return headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
}

function mutationRequest(options: {
  csrfCookie?: string;
  csrfHeader?: string;
  origin?: string;
  referer?: string;
  session?: string;
} = {}): NextRequest {
  const headers = new Headers({"content-type": "application/json"});
  const cookies: string[] = [];
  if (options.csrfCookie) cookies.push(`ipam_csrf=${options.csrfCookie}`);
  if (options.session) cookies.push(`ipam_session=${options.session}`);
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
  if (options.csrfHeader) headers.set("x-csrf-token", options.csrfHeader);
  if (options.origin) headers.set("origin", options.origin);
  if (options.referer) headers.set("referer", options.referer);

  return new NextRequest(`${APP_ORIGIN}/api/prefixes/missing/generate-ips`, {
    body: "{}",
    headers,
    method: "POST",
  });
}

describe("BFF authentication boundary", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses host-prefixed secure cookies only in production", () => {
    const production = getAuthCookieConfig(true);
    expect(production.session).toEqual({
      name: "__Host-ipam_session",
      options: {httpOnly: true, path: "/", sameSite: "lax", secure: true},
    });
    expect(production.csrf).toEqual({
      name: "__Host-ipam_csrf",
      options: {httpOnly: false, path: "/", sameSite: "lax", secure: true},
    });
    expect("domain" in production.session.options).toBe(false);
    expect("domain" in production.csrf.options).toBe(false);

    const development = getAuthCookieConfig(false);
    expect(development.session.name).toBe("ipam_session");
    expect(development.csrf.name).toBe("ipam_csrf");
    expect(development.session.options.secure).toBe(false);
    expect(development.csrf.options.secure).toBe(false);
  });

  it("prepares login CSRF and returns a token-free login response with rotated cookies", async () => {
    const preflight = await prepareLogin();
    expect(preflight.status).toBe(204);
    const preflightCookie = getSetCookies(preflight).find((cookie) => cookie.startsWith("ipam_csrf="));
    expect(preflightCookie).toMatch(/Path=\//i);
    expect(preflightCookie).toMatch(/SameSite=lax/i);
    expect(preflightCookie).not.toMatch(/HttpOnly/i);
    expect(preflightCookie).not.toMatch(/Secure/i);
    expect(preflightCookie).not.toMatch(/Domain=/i);

    const user = {email: "admin@example.com", id: "user-1", role: "Admin", username: "admin"};
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      token: "backend-token",
      user,
    }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": "backend_cookie=must-not-leak",
        "x-backend-secret": "must-not-leak",
      },
      status: 201,
    }));
    const request = new NextRequest(`${APP_ORIGIN}/api/auth/login`, {
      body: JSON.stringify({password: "password", username: "admin"}),
      headers: {
        authorization: "Bearer browser-token",
        cookie: `ipam_csrf=${CSRF_TOKEN}; ipam_session=stale-session`,
        "content-type": "application/json",
        origin: APP_ORIGIN,
        "x-bootstrap-token": "browser-bootstrap-token",
        "x-csrf-token": CSRF_TOKEN,
      },
      method: "POST",
    });

    const response = await login(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({user});
    const upstreamHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(upstreamHeaders.has("authorization")).toBe(false);
    expect(upstreamHeaders.has("cookie")).toBe(false);
    expect(upstreamHeaders.has("x-bootstrap-token")).toBe(false);
    expect(upstreamHeaders.has("x-csrf-token")).toBe(false);
    const responseCookies = getSetCookies(response);
    expect(responseCookies.some((cookie) => /^ipam_session=.*HttpOnly/i.test(cookie))).toBe(true);
    expect(responseCookies.some((cookie) => /^ipam_csrf=.*HttpOnly/i.test(cookie))).toBe(false);
    expect(responseCookies.some((cookie) => cookie.includes("backend_cookie"))).toBe(false);
    expect(response.headers.has("x-backend-secret")).toBe(false);
  });

  it.each([
    ["origin-same", {csrfCookie: CSRF_TOKEN, csrfHeader: CSRF_TOKEN, origin: APP_ORIGIN}, 200],
    ["referer-same", {csrfCookie: CSRF_TOKEN, csrfHeader: CSRF_TOKEN, referer: `${APP_ORIGIN}/settings`}, 200],
    ["sources-missing", {csrfCookie: CSRF_TOKEN, csrfHeader: CSRF_TOKEN}, 403],
    ["referer-malformed", {csrfCookie: CSRF_TOKEN, csrfHeader: CSRF_TOKEN, referer: "not-a-url"}, 403],
    ["referer-foreign", {csrfCookie: CSRF_TOKEN, csrfHeader: CSRF_TOKEN, referer: "https://evil.example/path"}, 403],
    ["origin-foreign-referer-same", {csrfCookie: CSRF_TOKEN, csrfHeader: CSRF_TOKEN, origin: "https://evil.example", referer: `${APP_ORIGIN}/settings`}, 403],
    ["csrf-wrong", {csrfCookie: CSRF_TOKEN, csrfHeader: "wrong", origin: APP_ORIGIN}, 403],
  ] as const)("enforces %s mutation policy", async (_name, options, expectedStatus) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", {status: 200}));
    const response = await proxyPost(
      mutationRequest({...options, session: SESSION_TOKEN}),
      {params: Promise.resolve({path: ["prefixes", "missing", "generate-ips"]})},
    );

    expect(response.status).toBe(expectedStatus);
    expect(fetchMock).toHaveBeenCalledTimes(expectedStatus === 200 ? 1 : 0);
  });

  it.each([
    ["operator bootstrap", ["auth", "bootstrap"]],
    ["case-variant login", ["AUTH", "login"]],
  ])("keeps %s outside the generic proxy", async (_name, path) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", {status: 200}));
    const response = await proxyPost(
      mutationRequest({
        csrfCookie: CSRF_TOKEN,
        csrfHeader: CSRF_TOKEN,
        origin: APP_ORIGIN,
        session: SESSION_TOKEN,
      }),
      {params: Promise.resolve({path})},
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replaces a browser request ID and correlates the fixed proxy 502", async () => {
    // Given
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connect ECONNREFUSED http://internal-backend.example"),
    );
    const browserRequest = new NextRequest(`${APP_ORIGIN}/api/prefixes`, {
      headers: {"x-request-id": "browser-controlled-id"},
    });

    // When
    const response = await proxyGet(
      browserRequest,
      {params: Promise.resolve({path: ["prefixes"]})},
    );

    // Then
    const upstreamHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const requestId = upstreamHeaders.get("x-request-id");
    expect(requestId).toMatch(UUID_PATTERN);
    expect(requestId).not.toBe("browser-controlled-id");
    expect(response.status).toBe(502);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({message: "API proxy failed to reach backend"});
  });

  it("translates the session to Bearer for me and exposes only user fields", async () => {
    const user = {email: null, id: "user-1", role: "Admin", username: "admin"};
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ...user,
      token: "must-not-leak",
    }), {
      headers: {"content-type": "application/json", "set-cookie": "backend_cookie=must-not-leak"},
      status: 200,
    }));
    const request = new NextRequest(`${APP_ORIGIN}/api/auth/me`, {
      headers: {authorization: "Bearer browser-token", cookie: `ipam_session=${SESSION_TOKEN}`},
    });

    const response = await me(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(user);
    const upstreamHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(upstreamHeaders.get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(getSetCookies(response).some((cookie) => cookie.includes("backend_cookie"))).toBe(false);
  });

  it("revokes the server session and clears both exact cookies on logout", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ok: true}), {
      headers: {"content-type": "application/json", "set-cookie": "backend_cookie=must-not-leak"},
      status: 201,
    }));
    const request = new NextRequest(`${APP_ORIGIN}/api/auth/logout`, {
      headers: {
        authorization: "Bearer browser-token",
        cookie: `ipam_session=${SESSION_TOKEN}; ipam_csrf=${CSRF_TOKEN}`,
        origin: APP_ORIGIN,
        "x-csrf-token": CSRF_TOKEN,
      },
      method: "POST",
    });

    const response = await logout(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ok: true});
    const upstreamHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(upstreamHeaders.get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
    const cleared = getSetCookies(response);
    expect(cleared).toHaveLength(2);
    expect(cleared.every((cookie) => /Max-Age=0/i.test(cookie))).toBe(true);
    expect(cleared.every((cookie) => /Path=\//i.test(cookie) && /SameSite=lax/i.test(cookie))).toBe(true);
    expect(cleared.some((cookie) => /^ipam_session=.*HttpOnly/i.test(cookie))).toBe(true);
    expect(cleared.some((cookie) => /^ipam_csrf=.*HttpOnly/i.test(cookie))).toBe(false);
    expect(cleared.some((cookie) => cookie.includes("backend_cookie"))).toBe(false);
  });
});
