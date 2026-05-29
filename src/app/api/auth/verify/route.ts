import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signSession, setSessionCookie } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return redirectToLogin(req, "missing-token");
  }

  const link = await prisma.magicLinkToken.findUnique({ where: { token } });
  if (!link) return redirectToLogin(req, "invalid");
  if (link.expiresAt < new Date()) return redirectToLogin(req, "expired");

  // Consume atomically: the guard on `usedAt: null` means only one of two
  // concurrent verifications of the same token can win. A losing request
  // (count === 0) sees the token as already used. This closes the
  // check-then-update race a separate findUnique + update would leave open.
  const consumed = await prisma.magicLinkToken.updateMany({
    where: { id: link.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) return redirectToLogin(req, "used");

  // Upsert user — first verification creates the account.
  const user = await prisma.user.upsert({
    where: { email: link.email },
    update: { lastSeenAt: new Date() },
    create: { email: link.email },
  });

  const jwt = await signSession({ id: user.id, email: user.email });
  await setSessionCookie(jwt);

  // Send them home.
  const home = req.nextUrl.clone();
  home.pathname = "/";
  home.search = "";
  return NextResponse.redirect(home);
}

function redirectToLogin(req: NextRequest, reason: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?error=${reason}`;
  return NextResponse.redirect(url);
}
