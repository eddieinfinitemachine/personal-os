import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { exchangeStravaCode, isStravaConfigured, STRAVA_STATE_COOKIE, syncStrava } from "@/lib/strava";

// Strava sends the athlete back here after the consent page. Check the state
// against the cookie, require activity read access, store the tokens, pull the
// last 30 days, and land on /workout?strava=connected|denied|error.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: "connected" | "denied" | "error") => {
    const res = NextResponse.redirect(new URL(`/workout?strava=${result}`, url.origin));
    res.cookies.delete({ name: STRAVA_STATE_COOKIE, path: "/api/strava" });
    return res;
  };
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cookieState = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${STRAVA_STATE_COOKIE}=`))
    ?.slice(STRAVA_STATE_COOKIE.length + 1);
  const state = url.searchParams.get("state");
  if (!isStravaConfigured() || !state || state !== cookieState) return back("error");
  if (url.searchParams.get("error")) return back("denied");
  const scope = url.searchParams.get("scope") ?? "";
  const code = url.searchParams.get("code");
  if (!code || !/activity:read/.test(scope)) return back("denied");
  try {
    const t = await exchangeStravaCode(code);
    const data = {
      athleteId: String(t.athlete?.id ?? ""),
      athleteName: [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(" ") || null,
      scope,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: new Date(t.expires_at * 1000),
      lastSyncAt: null,
    };
    await prisma.stravaConnection.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  } catch (err) {
    console.error("strava connect failed", err);
    return back("error");
  }
  await syncStrava(userId, { force: true }).catch((err) => console.error("strava first sync failed", err));
  return back("connected");
}
