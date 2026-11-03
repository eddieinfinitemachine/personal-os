// Strava → workout log. Each user connects their own Strava account (OAuth,
// activity:read_all); recent activities are pulled into WorkoutLog as
// source "strava" records, so runs and rides show in the workout history and
// the planner's training log. Strava rotates refresh tokens, so they live in
// StravaConnection rather than env (unlike the founder-only lib/google.ts).
//
// Needs STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET from a Strava API app whose
// "Authorization Callback Domain" is this app's host.

import { prisma } from "@/lib/prisma";
import type { Focus } from "@/lib/workout";
import type { WorkoutRecord } from "@/lib/workout-history";

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize";
const API = "https://www.strava.com/api/v3";
export const STRAVA_SCOPE = "read,activity:read_all";
export const STRAVA_STATE_COOKIE = "strava-oauth-state";

const MINUTE = 60_000;
const DAY = 86_400_000;
/** A page load syncs at most this often. */
const SYNC_EVERY = 30 * MINUTE;
/** The first sync reaches back this far; later ones re-read a little overlap for late uploads and edits. */
const FIRST_SYNC = 30 * DAY;
const OVERLAP = 2 * DAY;

export function isStravaConfigured(): boolean {
  return !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

export function stravaRedirectUri(origin: string): string {
  return `${origin}/api/strava/callback`;
}

export function stravaAuthorizeUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID ?? "",
    redirect_uri: stravaRedirectUri(origin),
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${q}`;
}

export type StravaTokens = {
  access_token: string;
  refresh_token: string;
  /** Epoch seconds. */
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
};

async function tokenRequest(params: Record<string, string>): Promise<StravaTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID ?? "",
      client_secret: process.env.STRAVA_CLIENT_SECRET ?? "",
      ...params,
    }),
  });
  if (!res.ok) throw new Error(`Strava token request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as StravaTokens;
}

export function exchangeStravaCode(code: string): Promise<StravaTokens> {
  return tokenRequest({ code, grant_type: "authorization_code" });
}

type Connection = { userId: string; accessToken: string; refreshToken: string; expiresAt: Date; lastSyncAt: Date | null };

/** A usable access token, refreshed (and the rotated tokens saved) when it's within 5 minutes of expiring. */
async function accessToken(conn: Connection, now: number): Promise<string> {
  if (conn.expiresAt.getTime() - now > 5 * MINUTE) return conn.accessToken;
  const t = await tokenRequest({ refresh_token: conn.refreshToken, grant_type: "refresh_token" });
  await prisma.stravaConnection.update({
    where: { userId: conn.userId },
    data: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: new Date(t.expires_at * 1000) },
  });
  return t.access_token;
}

/** Best effort: tell Strava to drop the app's access. */
export async function deauthorizeStrava(conn: Connection): Promise<void> {
  const token = await accessToken(conn, Date.now());
  await fetch(DEAUTHORIZE_URL, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

// ---- Activities ------------------------------------------------------------

export type StravaActivity = {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  /** ISO, UTC. */
  start_date: string;
  /** Seconds. */
  elapsed_time: number;
  moving_time: number;
  /** Meters. */
  distance?: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
};

const MOBILITY = new Set(["Yoga", "Pilates"]);
const STRENGTH = new Set(["WeightTraining", "Crossfit", "Workout", "HighIntensityIntervalTraining"]);

export function stravaFocus(sport: string): Focus {
  return MOBILITY.has(sport) ? "mobility" : STRENGTH.has(sport) ? "full-body" : "conditioning";
}

function sportOf(a: StravaActivity): string {
  return a.sport_type || a.type || "Workout";
}

/** "6.2 mi · 812 ft climb · avg HR 148 · Run". */
export function activityNotes(a: StravaActivity): string {
  const miles = (a.distance ?? 0) / 1609.344;
  const feet = (a.total_elevation_gain ?? 0) * 3.28084;
  return [
    miles >= 0.1 ? `${miles.toFixed(1)} mi` : "",
    feet >= 50 ? `${Math.round(feet)} ft climb` : "",
    a.average_heartrate ? `avg HR ${Math.round(a.average_heartrate)}` : "",
    sportOf(a).replace(/([a-z])([A-Z])/g, "$1 $2"),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function activityRecord(a: StravaActivity): WorkoutRecord | null {
  const startedAt = Date.parse(a.start_date);
  if (!Number.isFinite(startedAt) || !a.id) return null;
  const elapsed = Math.max(60, a.elapsed_time || a.moving_time || 0);
  return {
    id: `strava-${a.id}`,
    source: "strava",
    title: (a.name || sportOf(a)).trim().slice(0, 120),
    focus: stravaFocus(sportOf(a)),
    startedAt,
    finishedAt: startedAt + elapsed * 1000,
    durationMin: Math.max(1, Math.min(600, Math.round((a.moving_time || elapsed) / 60))),
    exercises: [],
    notes: activityNotes(a),
  };
}

function missingTable(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2021";
}

/**
 * Pull new Strava activities into the user's workout log. Null when the user
 * hasn't connected Strava (or the table isn't there yet); skipped when the
 * last sync is under 30 minutes old unless forced. A strength activity that
 * overlaps a session already logged here (the watch recorded the guided
 * workout) is left out.
 */
export async function syncStrava(userId: string, opts: { force?: boolean; now?: number } = {}): Promise<{ synced: number } | null> {
  const now = opts.now ?? Date.now();
  let conn: Connection | null;
  try {
    conn = await prisma.stravaConnection.findUnique({ where: { userId } });
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  if (!conn || !isStravaConfigured()) return null;
  if (!opts.force && conn.lastSyncAt && now - conn.lastSyncAt.getTime() < SYNC_EVERY) return { synced: 0 };

  const token = await accessToken(conn, now);
  const after = Math.floor(((conn.lastSyncAt ? conn.lastSyncAt.getTime() - OVERLAP : now - FIRST_SYNC)) / 1000);
  const activities: StravaActivity[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`${API}/athlete/activities?after=${after}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Strava activities failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const batch = (await res.json()) as StravaActivity[];
    activities.push(...batch);
    if (batch.length < 100) break;
  }

  const records = activities.map(activityRecord).filter((r): r is WorkoutRecord => r !== null);
  const ours = records.length
    ? await prisma.workoutLog.findMany({
        where: {
          userId,
          source: { not: "strava" },
          finishedAt: { gte: new Date(Math.min(...records.map((r) => r.startedAt))) },
        },
        select: { startedAt: true, finishedAt: true },
      })
    : [];
  const keep = records.filter(
    (r) =>
      r.focus !== "full-body" ||
      !ours.some((o) => o.startedAt.getTime() < r.finishedAt && o.finishedAt.getTime() > r.startedAt),
  );
  for (const r of keep) {
    const data = {
      source: "strava",
      title: r.title,
      focus: r.focus,
      startedAt: new Date(r.startedAt),
      finishedAt: new Date(r.finishedAt),
      durationMin: r.durationMin,
      exercises: [],
      notes: r.notes ?? null,
    };
    await prisma.workoutLog.upsert({
      where: { userId_clientId: { userId, clientId: r.id } },
      create: { userId, clientId: r.id, ...data },
      update: data,
    });
  }
  await prisma.stravaConnection.update({ where: { userId }, data: { lastSyncAt: new Date(now) } });
  return { synced: keep.length };
}
