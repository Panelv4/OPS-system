import { NextResponse, type NextRequest } from "next/server";

/**
 * Attaches a request id to every request and emits one structured access line.
 *
 * The query string is deliberately never logged: reset and invitation links carry
 * their token there, and a log aggregator is exactly the wrong place for it.
 */
export function middleware(request: NextRequest) {
  const incoming = request.headers.get("x-request-id");
  const requestId = incoming && /^[A-Za-z0-9._-]{8,80}$/.test(incoming) ? incoming : crypto.randomUUID();

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);

  // Skip asset noise so the log stays about application behaviour.
  const { pathname } = request.nextUrl;
  if (!/^\/(_next|favicon\.ico|icon\.svg)/.test(pathname)) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      service: "opspilot",
      event: "http.request",
      requestId,
      method: request.method,
      path: pathname,
    }));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
