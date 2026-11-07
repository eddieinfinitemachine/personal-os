import { verifySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Resolves a capture request's credential to a user id. Two credentials work,
// checked in this order:
//
// 1. A static capture token, as a bearer header or ?token= param, from two
//    env vars:
//      CAPTURE_TOKEN  — the original single-user token; maps to FOUNDER_EMAIL.
//      CAPTURE_TOKENS — optional JSON map of extra tokens for teammates:
//                       '{"<token>":"teammate@example.com"}'
// 2. The app session: the same signed-in session JWT the native app gets from
//    the magic link, as `Authorization: Bearer <jwt>` only (never ?token=, so a
//    long-lived session stays out of URLs and logs). It resolves to the
//    session's user once that user row is confirmed to exist.
//
// Returns the user id, or null when neither credential is valid (routes
// answer 401). With no CAPTURE_TOKEN configured, dev stays open (founder) and
// production stays fail-closed for everything but a valid session.
export async function resolveCaptureUser(request: Request): Promise<string | null> {
  const bearer = bearerToken(request);
  const email = resolveEmail(request, bearer);
  if (!email) return bearer && JWT_SHAPE.test(bearer) ? resolveSessionUser(bearer) : null;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Valid token pointing at a nonexistent account — a config error, not an
    // auth failure; log so it's diagnosable from Vercel logs.
    console.error(`capture token maps to unknown user ${email}`);
    return null;
  }
  return user.id;
}

// Three base64url segments: header.payload.signature.
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
}

function resolveEmail(request: Request, bearer: string | null): string | null {
  const founderEmail = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const secret = process.env.CAPTURE_TOKEN;
  if (!secret) {
    return process.env.NODE_ENV !== "production" ? founderEmail : null;
  }
  const token = bearer ?? new URL(request.url).searchParams.get("token");
  if (!token) return null;
  if (token === secret) return founderEmail;
  return parseTokenMap(process.env.CAPTURE_TOKENS)[token] ?? null;
}

async function resolveSessionUser(jwt: string): Promise<string | null> {
  const session = await verifySession(jwt);
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } });
  if (!user) {
    // Validly signed session for an account that's gone (deleted, or a
    // different database) — log like the unknown-token-user case.
    console.error(`capture session for unknown user ${session.userId}`);
    return null;
  }
  return user.id;
}

function parseTokenMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
    }
  } catch {
    console.error("CAPTURE_TOKENS is not valid JSON — ignoring");
  }
  return {};
}
