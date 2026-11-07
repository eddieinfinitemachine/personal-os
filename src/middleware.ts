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
const SESSION_COOKIE = "ec-session";

// Public paths — landing/signup/login and the auth API.
const PUBLIC_PREFIXES = ["/login", "/signup", "/api/auth"];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// The session's user id, or null when the token is missing, invalid or expired.
async function sessionUserId(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Forward pathname so server components can branch.
  const fwd = new Headers(req.headers);
  fwd.set("x-pathname", pathname);
  // x-user-id is only ever set below from a verified session. Drop any
  // client-supplied copy so bearer passthrough routes can't be spoofed.
  fwd.delete("x-user-id");

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
    // Scoped journal connector routes authenticate their own bearer token.
    pathname.startsWith("/api/dating/intake/") ||
    pathname.startsWith("/api/capture/") ||
    // Read-later save from the iOS share-sheet Shortcut (route checks
    // CAPTURE_TOKEN or session itself). The Shortcut's "Get contents of URL"
    // defaults to GET, so a GET carrying ?url= is a save too; a bare GET
    // (the in-app list) stays behind the session.
    (pathname === "/api/reader" &&
      (req.method === "POST" || req.nextUrl.searchParams.has("url"))) ||
    // Mood board save: share-sheet Shortcut / extension (bearer) or the app
    // (cookie); the route resolves either itself.
    (pathname === "/api/board" && req.method === "POST")
  ) {
    return passthrough();
  }

  // Verify session — populate x-user-id on success. The web app sends the
  // session cookie; the native app sends the same kind of JWT as a bearer.
  const authorization = req.headers.get("authorization");
  let userId = await sessionUserId(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId && authorization?.startsWith("Bearer ")) {
    userId = await sessionUserId(authorization.slice("Bearer ".length));
  }

  if (userId) {
    return passthrough({ "x-user-id": userId });
  }

  if (isPublic(pathname)) {
    return passthrough();
  }

  // A native client (it sends Authorization) can't follow a login redirect:
  // answer its API calls with a JSON 401 instead.
  if (authorization && pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
