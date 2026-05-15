import { NextRequest, NextResponse } from "next/server";

// Routes that should never be gated.
const PUBLIC_PATHS = ["/login", "/api/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Forward the pathname so server components (root layout) can branch on it
  // without re-parsing the URL.
  const fwd = new Headers(req.headers);
  fwd.set("x-pathname", pathname);
  const passthrough = () =>
    NextResponse.next({ request: { headers: fwd } });

  // Skip framework / asset routes (and the iOS shortcut bundle so it can be
  // installed by tapping the URL without going through the password gate).
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/manifest") ||
    pathname === "/sw.js" ||
    pathname.endsWith(".shortcut")
  ) {
    return passthrough();
  }

  // Allow cron + capture endpoints to bypass cookie auth — they have their own
  // bearer-token gating.
  if (
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/capture/") ||
    pathname.startsWith("/api/admin/")
  ) {
    return passthrough();
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return passthrough();
  }

  const authed = req.cookies.get("personalos-auth")?.value === "ok";
  if (authed) return passthrough();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
