import { prisma } from "@/lib/prisma";

// Resolves a capture request's bearer token (or ?token= param) to a user id.
//
// Tokens come from two env vars:
//   CAPTURE_TOKEN  — the original single-user token; maps to FOUNDER_EMAIL.
//   CAPTURE_TOKENS — optional JSON map of extra tokens for teammates:
//                    '{"<token>":"teammate@example.com"}'
//
// Returns the user id, or null when the token is missing/unknown (routes
// answer 401). With no CAPTURE_TOKEN configured, dev stays open (founder) and
// production stays fail-closed — same as the old per-route checks.
export async function resolveCaptureUser(request: Request): Promise<string | null> {
  const email = resolveEmail(request);
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Valid token pointing at a nonexistent account — a config error, not an
    // auth failure; log so it's diagnosable from Vercel logs.
    console.error(`capture token maps to unknown user ${email}`);
    return null;
  }
  return user.id;
}

function resolveEmail(request: Request): string | null {
  const founderEmail = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const secret = process.env.CAPTURE_TOKEN;
  if (!secret) {
    return process.env.NODE_ENV !== "production" ? founderEmail : null;
  }
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const token = bearer ?? new URL(request.url).searchParams.get("token");
  if (!token) return null;
  if (token === secret) return founderEmail;
  return parseTokenMap(process.env.CAPTURE_TOKENS)[token] ?? null;
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
