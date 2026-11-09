import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { APP_SESSION_MAX_AGE, signSession, setSessionCookie } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPrivateHost } from "@/lib/hosts";

// Password sign-in for the private single-operator host (internal.eddiecohen.com).
// Public multi-tenant EC stays magic-link only. The shared password lives in
// INTERNAL_PASSWORD; the account it signs into is FOUNDER_EMAIL (same account the
// bearer-token / cron endpoints attach data to).
//
// The web sends { password } and gets the session cookie. The native app sends
// { password, client: "app" } and gets a long-lived session back in the body
// instead (the same kind of session the magic link's `client=app` issues), which
// it keeps and sends as `Authorization: Bearer`.

function safeEqual(a: string, b: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length buffers and we never
  // leak the secret's length.
  const ah = crypto.createHash("sha256").update(a).digest();
  const bh = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export async function POST(req: NextRequest) {
  // Gate strictly to private hosts — never expose password auth on public EC.
  if (!isPrivateHost(req.headers.get("host"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const password = process.env.INTERNAL_PASSWORD;
  const email = process.env.FOUNDER_EMAIL?.trim().toLowerCase();
  if (!password || !email) {
    // Feature not configured — fail closed.
    return NextResponse.json({ error: "Password sign-in isn't configured." }, { status: 503 });
  }

  // Rate limit by IP to blunt brute force (3 / 10 min, shared with magic link).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(`pw:ip:${ip}`);
  if (!rl.allowed) {
    const mins = Math.ceil((rl.retryAfterMs ?? 0) / 60000);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` },
      { status: 429 },
    );
  }

  let provided: string;
  // `client: "app"` marks a sign-in from the native app; anything else is web.
  let client: "app" | undefined;
  try {
    const body = (await req.json()) as { password?: string; client?: unknown };
    if (!body.password || typeof body.password !== "string") {
      return NextResponse.json({ error: "password required" }, { status: 400 });
    }
    provided = body.password;
    client = body.client === "app" ? "app" : undefined;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!safeEqual(provided, password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: { lastSeenAt: new Date() },
    create: { email },
  });

  if (client === "app") {
    const token = await signSession(
      { id: user.id, email: user.email },
      { maxAge: APP_SESSION_MAX_AGE, client: "app" },
    );
    return NextResponse.json(
      { ok: true, token, email: user.email },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const jwt = await signSession({ id: user.id, email: user.email });
  await setSessionCookie(jwt);

  return NextResponse.json({ ok: true });
}
