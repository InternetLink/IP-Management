import {type NextRequest, NextResponse} from "next/server";

import {
  authSuccess,
  backendUnavailable,
  badGateway,
  parseLoginPayload,
  readBackendJson,
  sanitizedBackendError,
} from "../../_lib/auth-response";
import {
  fetchBackend,
  setAuthenticatedCookies,
  setCsrfCookie,
  validateBrowserMutation,
} from "../../_lib/bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOGIN_CSRF_TTL_MS = 10 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const response = new NextResponse(null, {
    headers: {"cache-control": "no-store"},
    status: 204,
  });
  setCsrfCookie(response, new Date(Date.now() + LOGIN_CSRF_TTL_MS));
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rejection = validateBrowserMutation(request);
  if (rejection) return rejection;

  let backendResponse: Response;
  try {
    backendResponse = await fetchBackend(request, "auth/login", {includeSession: false});
  } catch {
    return backendUnavailable();
  }

  const payload = await readBackendJson(backendResponse);
  if (!backendResponse.ok) return sanitizedBackendError(backendResponse, payload);

  const loginPayload = parseLoginPayload(payload);
  if (!loginPayload) return badGateway();

  const response = authSuccess({user: loginPayload.user});
  setAuthenticatedCookies(response, loginPayload.token, loginPayload.expiresAt);
  return response;
}
