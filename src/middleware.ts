import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

function resolveJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail closed in production (see lib/auth.ts).
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required in production");
    }
    return new TextEncoder().encode("dev-secret-not-for-production");
  }
  return new TextEncoder().encode(secret);
}

// Lazy + memoized: Sensitive env vars aren't present during `next build`, so
// resolving at import would throw the fail-closed error at build time. See
// lib/auth.ts.
let cachedJwtSecret: Uint8Array | null = null;
function jwtSecret(): Uint8Array {
  return (cachedJwtSecret ??= resolveJwtSecret());
}
const SESSION_COOKIE = "kaizen-session";

// Public paths — landing/signup/login and the auth API.
const PUBLIC_PREFIXES = ["/login", "/signup", "/api/auth"];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Forward pathname so server components can branch.
  const fwd = new Headers(req.headers);
  fwd.set("x-pathname", pathname);

  const passthrough = (extra?: Record<string, string>) => {
    if (extra) for (const [k, v] of Object.entries(extra)) fwd.set(k, v);
    return NextResponse.next({ request: { headers: fwd } });
  };

  // Framework / static / PWA assets.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-icon") ||
    pathname.startsWith("/manifest") ||
    pathname === "/sw.js" ||
    pathname.startsWith("/workbox-") ||
    pathname.startsWith("/swe-worker-") ||
    pathname.endsWith(".shortcut")
  ) {
    return passthrough();
  }

  // Bearer-token endpoints handle their own auth.
  if (
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/capture/") ||
    // Read-later save from the iOS share-sheet Shortcut (route checks
    // CAPTURE_TOKEN or session itself; GET stays behind the session).
    (pathname === "/api/reader" && req.method === "POST")
  ) {
    return passthrough();
  }

  // Verify session — populate x-user-id on success.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  let userId: string | null = null;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, jwtSecret());
      if (typeof payload.userId === "string") userId = payload.userId;
    } catch {
      // Invalid/expired — fall through.
    }
  }

  if (userId) {
    return passthrough({ "x-user-id": userId });
  }

  if (isPublic(pathname)) {
    return passthrough();
  }

  // Unauthenticated request to a gated route → redirect to /login.
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
