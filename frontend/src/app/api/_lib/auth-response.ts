import {NextResponse} from "next/server";

export type AuthUser = {
  email: string | null;
  id: string;
  role: string;
  username: string;
};

export type LoginPayload = {
  expiresAt: number;
  token: string;
  user: AuthUser;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAuthUser(value: unknown): AuthUser | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string"
    || typeof value.username !== "string"
    || typeof value.role !== "string"
    || !(typeof value.email === "string" || value.email === null)
  ) return null;

  return {
    email: value.email,
    id: value.id,
    role: value.role,
    username: value.username,
  };
}

export function parseLoginPayload(value: unknown): LoginPayload | null {
  if (!isRecord(value)) return null;
  const user = parseAuthUser(value.user);
  if (
    !user
    || typeof value.token !== "string"
    || value.token.length === 0
    || typeof value.expiresAt !== "number"
    || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= Math.floor(Date.now() / 1000)
  ) return null;

  return {expiresAt: value.expiresAt, token: value.token, user};
}

export function isLogoutPayload(value: unknown): value is {ok: true} {
  return isRecord(value) && value.ok === true;
}

export async function readBackendJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function authSuccess(body: unknown): NextResponse {
  return NextResponse.json(body, {headers: {"cache-control": "no-store"}, status: 200});
}

export function badGateway(): NextResponse {
  return NextResponse.json(
    {message: "Authentication service returned an invalid response"},
    {headers: {"cache-control": "no-store"}, status: 502},
  );
}

export function backendUnavailable(): NextResponse {
  return NextResponse.json(
    {message: "Authentication service is unavailable"},
    {headers: {"cache-control": "no-store"}, status: 502},
  );
}

export function sanitizedBackendError(response: Response, value: unknown): NextResponse {
  const source = isRecord(value) ? value : {};
  const message = typeof source.message === "string" ? source.message : "Authentication request failed";
  const body: {code?: string; message: string; statusCode?: number} = {message};
  if (typeof source.code === "string") body.code = source.code;
  if (typeof source.statusCode === "number" && Number.isSafeInteger(source.statusCode)) {
    body.statusCode = source.statusCode;
  }

  const headers = new Headers({"cache-control": "no-store"});
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) headers.set("retry-after", retryAfter);
  return NextResponse.json(body, {headers, status: response.status});
}
