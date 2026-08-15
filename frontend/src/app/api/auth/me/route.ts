import {type NextRequest, NextResponse} from "next/server";

import {
  authSuccess,
  backendUnavailable,
  badGateway,
  parseAuthUser,
  readBackendJson,
  sanitizedBackendError,
} from "../../_lib/auth-response";
import {clearAuthCookies, fetchBackend, getSessionToken} from "../../_lib/bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authenticationRequired(): NextResponse {
  return NextResponse.json(
    {message: "Authentication required"},
    {headers: {"cache-control": "no-store"}, status: 401},
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!getSessionToken(request)) return authenticationRequired();

  let backendResponse: Response;
  try {
    backendResponse = await fetchBackend(request, "auth/me");
  } catch {
    return backendUnavailable();
  }

  const payload = await readBackendJson(backendResponse);
  if (!backendResponse.ok) {
    const response = sanitizedBackendError(backendResponse, payload);
    if (backendResponse.status === 401) clearAuthCookies(response);
    return response;
  }

  const user = parseAuthUser(payload);
  return user ? authSuccess(user) : badGateway();
}
