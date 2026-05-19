import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendMagicLinkEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";

const TOKEN_TTL_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  let email: string;
  try {
    const body = (await req.json()) as { email?: string };
    if (!body.email || typeof body.email !== "string") {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }
    email = body.email.trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  // Optional global signup cap — emergency kill-switch if randos show up.
  // Counts new users created in last 24h.
  const dailyCap = Number(process.env.MAX_SIGNUPS_PER_DAY ?? 0);
  if (dailyCap > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const recentSignups = await prisma.user.count({ where: { createdAt: { gte: since } } });
      if (recentSignups >= dailyCap) {
        return NextResponse.json(
          { error: "Signups are paused right now. Try again tomorrow." },
          { status: 429 },
        );
      }
    }
  }

  // Optional invite token — if set in env, signups without it are blocked.
  const requiredInvite = process.env.INVITE_TOKEN;
  if (requiredInvite) {
    const { searchParams } = new URL(req.url);
    const provided = searchParams.get("invite");
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing && provided !== requiredInvite) {
      return NextResponse.json(
        { error: "Signups are invite-only right now." },
        { status: 403 },
      );
    }
  }

  // Rate limit by email and by IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const emailRl = checkRateLimit(`email:${email}`);
  const ipRl = checkRateLimit(`ip:${ip}`);
  if (!emailRl.allowed || !ipRl.allowed) {
    const ms = Math.max(emailRl.retryAfterMs ?? 0, ipRl.retryAfterMs ?? 0);
    const mins = Math.ceil(ms / 60000);
    return NextResponse.json(
      { error: `Too many requests. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` },
      { status: 429 },
    );
  }

  // Create the token (we email it; the verify endpoint creates the user on first use).
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.magicLinkToken.create({
    data: { token, email, expiresAt },
  });

  // Use the request's own origin so links go back to whichever host the user
  // signed up from (kaizen.eddiecohen.com, internal.eddiecohen.com, etc.).
  // Falls back to APP_URL env when no origin is present (rare).
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("host");
  const origin = forwardedProto && host ? `${forwardedProto}://${host}` : new URL(req.url).origin;

  try {
    await sendMagicLinkEmail(email, token, origin);
  } catch (err) {
    console.error("magic link email failed", err);
    return NextResponse.json(
      { error: "Could not send email. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
