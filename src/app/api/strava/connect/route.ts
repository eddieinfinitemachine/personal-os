import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isStravaConfigured, STRAVA_STATE_COOKIE, stravaAuthorizeUrl } from "@/lib/strava";

// "Connect Strava": a one-time state in a short-lived cookie, then off to
// Strava's consent page, which comes back to /api/strava/callback.
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStravaConfigured()) return NextResponse.json({ error: "Strava isn't set up on this server." }, { status: 503 });
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(stravaAuthorizeUrl(new URL(request.url).origin, state));
  res.cookies.set(STRAVA_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/strava",
    maxAge: 600,
  });
  return res;
}
