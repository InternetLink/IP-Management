import {NextRequest} from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{path?: string[]}> | {path?: string[]};
};

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
];

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function stripApiSuffix(value: string) {
  return stripTrailingSlash(value).replace(/\/api$/, "");
}

function getApiProxyTarget() {
  const explicitTarget = process.env.API_PROXY_TARGET?.trim();
  if (explicitTarget) return stripApiSuffix(explicitTarget);

  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl && /^https?:\/\//.test(publicApiUrl)) return stripApiSuffix(publicApiUrl);

  return "http://127.0.0.1:3001";
}

function copyRequestHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  HOP_BY_HOP_HEADERS.forEach((header) => headers.delete(header));
  return headers;
}

async function proxy(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const path = params.path?.map(encodeURIComponent).join("/") ?? "";
  const proxyTarget = getApiProxyTarget();
  const target = `${proxyTarget}/api/${path}${request.nextUrl.search}`;
  const init: RequestInit = {
    method: request.method,
    headers: copyRequestHeaders(request),
    redirect: "manual",
    cache: "no-store",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  let response: Response;
  try {
    response = await fetch(target, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    return Response.json(
      {
        message: `API proxy failed to reach backend: ${message}`,
        target: proxyTarget,
      },
      {status: 502},
    );
  }

  const headers = new Headers(response.headers);
  HOP_BY_HOP_HEADERS.forEach((header) => headers.delete(header));

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
