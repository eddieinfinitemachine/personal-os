import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), logs: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stravaConnection: { findUnique: mocks.find, update: mocks.update },
    workoutLog: { findMany: mocks.logs, upsert: mocks.upsert },
  },
}));
import { activityNotes, activityRecord, stravaAuthorizeUrl, stravaFocus, syncStrava, type StravaActivity } from "./strava";

const NOW = Date.UTC(2026, 9, 17, 18);
const MIN = 60_000;
const run: StravaActivity = {
  id: 111, name: "Morning Run", sport_type: "TrailRun", start_date: new Date(NOW - 26 * 60 * MIN).toISOString(),
  elapsed_time: 3300, moving_time: 3120, distance: 9978, total_elevation_gain: 247.5, average_heartrate: 148.4,
};
const lift: StravaActivity = { id: 222, name: "Weight Training", sport_type: "WeightTraining", start_date: new Date(NOW - 5 * 60 * MIN).toISOString(), elapsed_time: 2700, moving_time: 2700 };
const conn = (extra: object = {}) => ({
  userId: "u1", accessToken: "old-access", refreshToken: "old-refresh", expiresAt: new Date(NOW + 60 * MIN), lastSyncAt: null, ...extra,
});
type Call = [string, RequestInit | undefined];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRAVA_CLIENT_ID", "123");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "shh");
  mocks.logs.mockResolvedValue([]);
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("https://www.strava.com/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_at: NOW / 1000 + 21600 }));
    }
    return new Response(JSON.stringify([run, lift]));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("activities → log records", () => {
  it("keeps the name, time, distance, climb and heart rate, and files runs under conditioning", () => {
    expect(activityRecord(run)).toEqual({
      id: "strava-111", source: "strava", title: "Morning Run", focus: "conditioning",
      startedAt: NOW - 26 * 60 * MIN, finishedAt: NOW - 26 * 60 * MIN + 3300 * 1000, durationMin: 52, exercises: [],
      notes: "6.2 mi · 812 ft climb · avg HR 148 · Trail Run",
    });
    expect(activityNotes(lift)).toBe("Weight Training");
    expect([stravaFocus("Yoga"), stravaFocus("Crossfit"), stravaFocus("Ride"), stravaFocus("Swim")]).toEqual(["mobility", "full-body", "conditioning", "conditioning"]);
    expect(activityRecord({ ...run, start_date: "nope" })).toBeNull();
  });
  it("sends the athlete to Strava's consent page for read access to activities", () => {
    const url = new URL(stravaAuthorizeUrl("https://ec.example", "st-1"));
    expect(url.origin + url.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123", redirect_uri: "https://ec.example/api/strava/callback", response_type: "code", approval_prompt: "auto", scope: "read,activity:read_all", state: "st-1",
    });
  });
});

describe("syncStrava", () => {
  it("pulls the last 30 days on the first sync and upserts each activity by its Strava id", async () => {
    mocks.find.mockResolvedValue(conn());
    expect(await syncStrava("u1", { now: NOW })).toEqual({ synced: 2 });
    const [url, init] = fetchMock.mock.calls[0] as Call;
    expect(url).toBe(`https://www.strava.com/api/v3/athlete/activities?after=${(NOW - 30 * 1440 * MIN) / 1000}&per_page=100&page=1`);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer old-access");
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId_clientId: { userId: "u1", clientId: "strava-111" } },
      create: expect.objectContaining({ userId: "u1", clientId: "strava-111", source: "strava", title: "Morning Run", exercises: [], notes: "6.2 mi · 812 ft climb · avg HR 148 · Trail Run" }),
      update: expect.objectContaining({ source: "strava", durationMin: 52 }),
    });
    expect(mocks.update).toHaveBeenCalledWith({ where: { userId: "u1" }, data: { lastSyncAt: new Date(NOW) } });
  });
  it("refreshes an expiring token and saves the rotated pair before reading", async () => {
    mocks.find.mockResolvedValue(conn({ expiresAt: new Date(NOW + 2 * MIN), lastSyncAt: new Date(NOW - 2 * 60 * MIN) }));
    await syncStrava("u1", { now: NOW });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as Call;
    expect(tokenUrl).toBe("https://www.strava.com/oauth/token");
    expect(Object.fromEntries(new URLSearchParams(String(tokenInit?.body)))).toEqual({ client_id: "123", client_secret: "shh", refresh_token: "old-refresh", grant_type: "refresh_token" });
    expect(mocks.update.mock.calls[0][0]).toEqual({ where: { userId: "u1" }, data: { accessToken: "new-access", refreshToken: "new-refresh", expiresAt: new Date(NOW + 21600 * 1000) } });
    const [listUrl, listInit] = fetchMock.mock.calls[1] as Call;
    // Re-reads two days before the last sync for late uploads and edits.
    expect(listUrl).toContain(`after=${(NOW - 2 * 60 * MIN - 2 * 1440 * MIN) / 1000}&`);
    expect((listInit?.headers as Record<string, string>).Authorization).toBe("Bearer new-access");
  });
  it("leaves out a strength activity recorded during a workout already in the log", async () => {
    mocks.find.mockResolvedValue(conn());
    mocks.logs.mockResolvedValue([{ startedAt: new Date(NOW - 5 * 60 * MIN - 5 * MIN), finishedAt: new Date(NOW - 4 * 60 * MIN) }]);
    expect(await syncStrava("u1", { now: NOW })).toEqual({ synced: 1 });
    expect(mocks.upsert.mock.calls.map((c) => c[0].where.userId_clientId.clientId)).toEqual(["strava-111"]);
    expect(mocks.logs.mock.calls[0][0].where).toEqual({ userId: "u1", source: { not: "strava" }, finishedAt: { gte: new Date(Date.parse(run.start_date)) } });
  });
  it("pages through busy months", async () => {
    mocks.find.mockResolvedValue(conn());
    const many = Array.from({ length: 100 }, (_, i) => ({ ...run, id: 1000 + i }));
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(many))).mockImplementationOnce(async () => new Response(JSON.stringify([lift])));
    expect(await syncStrava("u1", { now: NOW })).toEqual({ synced: 101 });
    expect((fetchMock.mock.calls[1] as Call)[0]).toContain("&page=2");
  });
  it("does nothing when not connected, recently synced, unconfigured or without the table", async () => {
    mocks.find.mockResolvedValue(null);
    expect(await syncStrava("u1", { now: NOW })).toBeNull();
    mocks.find.mockResolvedValue(conn({ lastSyncAt: new Date(NOW - 10 * MIN) }));
    expect(await syncStrava("u1", { now: NOW })).toEqual({ synced: 0 });
    vi.stubEnv("STRAVA_CLIENT_SECRET", "");
    expect(await syncStrava("u1", { now: NOW, force: true })).toBeNull();
    mocks.find.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
    expect(await syncStrava("u1", { now: NOW })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports a failed read without moving the sync mark", async () => {
    mocks.find.mockResolvedValue(conn());
    fetchMock.mockImplementationOnce(async () => new Response("Authorization Error", { status: 401 }));
    await expect(syncStrava("u1", { now: NOW })).rejects.toThrow("Strava activities failed (401)");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
