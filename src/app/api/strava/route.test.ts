import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), find: vi.fn(), upsert: vi.fn(), del: vi.fn(), exchange: vi.fn(), sync: vi.fn(), deauth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { stravaConnection: { findUnique: mocks.find, upsert: mocks.upsert, delete: mocks.del } } }));
vi.mock("@/lib/strava", async (orig) => ({
  ...(await orig<typeof import("@/lib/strava")>()),
  exchangeStravaCode: mocks.exchange,
  syncStrava: mocks.sync,
  deauthorizeStrava: mocks.deauth,
}));
import { DELETE, GET } from "./route";
import { GET as CONNECT } from "./connect/route";
import { GET as CALLBACK } from "./callback/route";

const base = "https://ec.example";
const callback = (query: string, state = "st-1") =>
  new Request(`${base}/api/strava/callback?${query}`, { headers: { cookie: `ec-session=x; strava-oauth-state=${state}` } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRAVA_CLIENT_ID", "123");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "shh");
  mocks.user.mockResolvedValue("u1");
  mocks.sync.mockResolvedValue({ synced: 4 });
  mocks.exchange.mockResolvedValue({ access_token: "a", refresh_token: "r", expires_at: 1_800_000_000, athlete: { id: 42, firstname: "Sam", lastname: "Lee" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("Strava status and disconnect", () => {
  it("reports configured / connected and the last sync", async () => {
    mocks.find.mockResolvedValueOnce({ athleteName: "Sam Lee", lastSyncAt: new Date(1_790_000_000_000) });
    expect(await (await GET(new Request(`${base}/api/strava`))).json()).toEqual({ configured: true, connected: true, athleteName: "Sam Lee", lastSyncAt: 1_790_000_000_000 });
    mocks.find.mockResolvedValueOnce(null);
    expect(await (await GET(new Request(`${base}/api/strava`))).json()).toMatchObject({ configured: true, connected: false });
    mocks.find.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "P2021" }));
    expect(await (await GET(new Request(`${base}/api/strava`))).json()).toEqual({ configured: true, connected: false });
    vi.stubEnv("STRAVA_CLIENT_ID", "");
    expect(await (await GET(new Request(`${base}/api/strava`))).json()).toEqual({ configured: false, connected: false });
  });
  it("disconnects: tells Strava (best effort) and forgets the tokens", async () => {
    mocks.find.mockResolvedValueOnce({ userId: "u1" });
    mocks.deauth.mockRejectedValueOnce(new Error("strava down"));
    expect(await (await DELETE(new Request(`${base}/api/strava`, { method: "DELETE" }))).json()).toEqual({ connected: false });
    expect(mocks.del).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});

describe("connecting", () => {
  it("sends the athlete to Strava with a one-time state cookie", async () => {
    const res = await CONNECT(new Request(`${base}/api/strava/connect`));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.host).toBe("www.strava.com");
    expect(to.searchParams.get("redirect_uri")).toBe(`${base}/api/strava/callback`);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`strava-oauth-state=${to.searchParams.get("state")}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toContain("Path=/api/strava");
    vi.stubEnv("STRAVA_CLIENT_SECRET", "");
    expect((await CONNECT(new Request(`${base}/api/strava/connect`))).status).toBe(503);
  });
  it("stores the tokens, pulls the last 30 days and lands back on the workout page", async () => {
    const res = await CALLBACK(callback("state=st-1&code=c-9&scope=read,activity:read_all"));
    expect(res.headers.get("location")).toBe(`${base}/workout?strava=connected`);
    expect(mocks.exchange).toHaveBeenCalledWith("c-9");
    const data = { athleteId: "42", athleteName: "Sam Lee", scope: "read,activity:read_all", accessToken: "a", refreshToken: "r", expiresAt: new Date(1_800_000_000_000), lastSyncAt: null };
    expect(mocks.upsert).toHaveBeenCalledWith({ where: { userId: "u1" }, create: { userId: "u1", ...data }, update: data });
    expect(mocks.sync).toHaveBeenCalledWith("u1", { force: true });
    expect(res.headers.get("set-cookie")).toContain("strava-oauth-state=;");
  });
  it("refuses a forged state, a denial, or missing activity access", async () => {
    expect((await CALLBACK(callback("state=other&code=c&scope=activity:read_all"))).headers.get("location")).toBe(`${base}/workout?strava=error`);
    expect((await CALLBACK(callback("state=st-1&error=access_denied"))).headers.get("location")).toBe(`${base}/workout?strava=denied`);
    expect((await CALLBACK(callback("state=st-1&code=c&scope=read"))).headers.get("location")).toBe(`${base}/workout?strava=denied`);
    expect(mocks.exchange).not.toHaveBeenCalled();
    mocks.exchange.mockRejectedValueOnce(new Error("bad code"));
    expect((await CALLBACK(callback("state=st-1&code=c&scope=activity:read"))).headers.get("location")).toBe(`${base}/workout?strava=error`);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
