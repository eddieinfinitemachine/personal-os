import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { signSession, setSessionCookie } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPrivateHost } from "@/lib/hosts";

// Password sign-in for the private single-operator host (internal.eddiecohen.com).
// Public multi-tenant Kaizen stays magic-link only. The shared password lives in
// INTERNAL_PASSWORD; the account it signs into is FOUNDER_EMAIL (same account the
// bearer-token / cron endpoints attach data to).

function safeEqual(a: string, b: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length buffers and we never
  // leak the secret's length.
  const ah = crypto.createHash("sha256").update(a).digest();
  const bh = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export async function POST(req: NextRequest) {
  // Gate strictly to private hosts — never expose password auth on public Kaizen.
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
  try {
    const body = (await req.json()) as { password?: string };
    if (!body.password || typeof body.password !== "string") {
      return NextResponse.json({ error: "password required" }, { status: 400 });
    }
    provided = body.password;
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

  const jwt = await signSession({ id: user.id, email: user.email });
  await setSessionCookie(jwt);

  return NextResponse.json({ ok: true });
}
