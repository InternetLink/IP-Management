import {NextRequest} from "next/server";

import {
  copySafeResponseHeaders,
  createRequestId,
  fetchBackend,
  REQUEST_ID_HEADER_NAME,
  validateBrowserMutation,
} from "../_lib/bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESERVED_AUTH_PATHS = new Set([
  "auth/bootstrap",
  "auth/login",
  "auth/logout",
  "auth/me",
]);

type RouteContext = {
  params: Promise<{path?: string[]}> | {path?: string[]};
};

async function proxy(request: NextRequest, context: RouteContext) {
  const rejection = validateBrowserMutation(request);
  if (rejection) return rejection;

  const params = await context.params;
  const pathSegments = params.path ?? [];
  const normalizedPath = pathSegments.map((segment) => segment.toLowerCase()).join("/");
  if (RESERVED_AUTH_PATHS.has(normalizedPath)) {
    return Response.json({message: "Not Found"}, {headers: {"cache-control": "no-store"}, status: 404});
  }

  const path = pathSegments.map(encodeURIComponent).join("/");
  const requestId = createRequestId();
  let response: Response;
  try {
    response = await fetchBackend(request, path, {requestId, search: request.nextUrl.search});
  } catch {
    return Response.json(
      {message: "API proxy failed to reach backend"},
      {headers: {"cache-control": "no-store", [REQUEST_ID_HEADER_NAME]: requestId}, status: 502},
    );
  }

  const headers = copySafeResponseHeaders(response.headers);
  headers.set(REQUEST_ID_HEADER_NAME, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
