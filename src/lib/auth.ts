import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

function resolveJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail closed: a missing signing key in production would let anyone forge
    // a session, so refuse to start rather than silently using a public default.
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required in production");
    }
    return new TextEncoder().encode("dev-secret-not-for-production");
  }
  return new TextEncoder().encode(secret);
}

// Resolve lazily (and memoize) rather than at module load. On Vercel,
// Sensitive env vars (JWT_SECRET) are injected at runtime only, not during
// `next build`'s page-data collection — evaluating at import would throw the
// fail-closed error at build time. Deferring to first use keeps the guard but
// only trips it when a request actually needs to sign/verify a session.
let cachedJwtSecret: Uint8Array | null = null;
function jwtSecret(): Uint8Array {
  return (cachedJwtSecret ??= resolveJwtSecret());
}

export const SESSION_COOKIE = "kaizen-session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export interface Session {
  userId: string;
  email: string;
}

export async function signSession(user: { id: string; email: string }): Promise<string> {
  return new SignJWT({ userId: user.id, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(jwtSecret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * For API routes: read the user-id forwarded by middleware (via x-user-id header)
 * or fall back to the cookie. Returns null if not authenticated.
 */
export async function getCurrentUserId(req?: NextRequest | Request): Promise<string | null> {
  if (req) {
    const headerUserId = req.headers.get("x-user-id");
    if (headerUserId) return headerUserId;
  }
  const session = await getSession();
  return session?.userId ?? null;
}

/**
 * Throws a Response with 401 if not authenticated. Use in API routes.
 */
export async function requireUserId(req?: NextRequest | Request): Promise<string> {
  const userId = await getCurrentUserId(req);
  if (!userId) {
    throw new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return userId;
}
