import {type NextRequest, NextResponse} from "next/server";

import {
  authSuccess,
  backendUnavailable,
  badGateway,
  isLogoutPayload,
  readBackendJson,
  sanitizedBackendError,
} from "../../_lib/auth-response";
import {
  clearAuthCookies,
  fetchBackend,
  getSessionToken,
  validateBrowserMutation,
} from "../../_lib/bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authenticationRequired(): NextResponse {
  return NextResponse.json(
    {message: "Authentication required"},
    {headers: {"cache-control": "no-store"}, status: 401},
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rejection = validateBrowserMutation(request);
  if (rejection) return rejection;

  let response: NextResponse;
  if (!getSessionToken(request)) {
    response = authenticationRequired();
  } else {
    try {
      const backendResponse = await fetchBackend(request, "auth/logout");
      const payload = await readBackendJson(backendResponse);
      if (!backendResponse.ok) {
        response = sanitizedBackendError(backendResponse, payload);
      } else {
        response = isLogoutPayload(payload) ? authSuccess({ok: true}) : badGateway();
      }
    } catch {
      response = backendUnavailable();
    }
  }

  clearAuthCookies(response);
  return response;
}
