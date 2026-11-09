import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  googleConfigured: vi.fn(),
  accessToken: vi.fn(),
  fetch: vi.fn(),
  cookie: { value: undefined as string | undefined },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser } } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (mocks.cookie.value ? { value: mocks.cookie.value } : undefined) }),
}));
vi.mock("@/lib/google", () => ({
  isGoogleConfigured: mocks.googleConfigured,
  getGoogleAccessToken: mocks.accessToken,
}));
import { signSession } from "@/lib/auth";
import { POST } from "./route";

const TOKEN = "test-capture-token";
const ACCESS_TOKEN = "test-google-access-token";
const GOOGLE_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none";
const users: Record<string, { id: string; email: string }> = {
  "founder@example.com": { id: "owner", email: "founder@example.com" },
  "mate@example.com": { id: "mate", email: "mate@example.com" },
};

const req = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  new Request("https://example.invalid/api/calendar/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const LUNCH = {
  title: "Lunch with Erin Miles",
  start: "2026-11-15T12:00:00-05:00",
  end: "2026-11-15T13:00:00-05:00",
};

const googleReply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": typeof body === "string" ? "text/plain" : "application/json" },
  });

/** Google's 200: the posted event back, with an id and link, in the event's own offset. */
const googleCreated = (over: Record<string, unknown> = {}) =>
  googleReply(200, {
    kind: "calendar#event",
    id: "evt123",
    htmlLink: "https://www.google.com/calendar/event?eid=evt123",
    summary: "Lunch with Erin Miles",
    start: { dateTime: "2026-11-15T12:00:00-05:00", timeZone: "America/New_York" },
    end: { dateTime: "2026-11-15T13:00:00-05:00", timeZone: "America/New_York" },
    ...over,
  });

/** The one call to Google: [url, init] with the JSON body parsed. */
const googleCall = () => {
  expect(mocks.fetch).toHaveBeenCalledOnce();
  const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) };
};

let quiet: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", "calendar-events-test-secret");
  vi.stubEnv("FOUNDER_EMAIL", "founder@example.com");
  vi.stubEnv("CAPTURE_TOKEN", TOKEN);
  vi.stubEnv("CAPTURE_TOKENS", JSON.stringify({ "mate-token": "mate@example.com" }));
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.cookie.value = undefined;
  mocks.findUser.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) =>
    where.email ? users[where.email] ?? null : Object.values(users).find((u) => u.id === where.id) ?? null,
  );
  mocks.googleConfigured.mockReturnValue(true);
  mocks.accessToken.mockResolvedValue(ACCESS_TOKEN);
  mocks.fetch.mockImplementation(async () => googleCreated());
  quiet = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  quiet.mockRestore();
});

describe("POST /api/calendar/events: auth", () => {
  it("401s without a valid capture token or session, and never calls Google", async () => {
    for (const auth of [null, "Bearer wrong", "Bearer not.a.jwt", "Basic dXNlcjpwYXNz"]) {
      const res = await POST(req(LUNCH, auth));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(mocks.accessToken).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("403s a teammate, by capture token or app session", async () => {
    const mateSession = await signSession(users["mate@example.com"], { client: "app" });
    for (const auth of ["Bearer mate-token", `Bearer ${mateSession}`]) {
      const res = await POST(req(LUNCH, auth));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Only the owner's account can add calendar events." });
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("503s when Google isn't configured", async () => {
    mocks.googleConfigured.mockReturnValue(false);
    const res = await POST(req(LUNCH));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Google Calendar isn't connected to Personal OS." });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("accepts the founder's app session as a bearer", async () => {
    const session = await signSession(users["founder@example.com"], { client: "app" });
    const res = await POST(req(LUNCH, `Bearer ${session}`));
    expect(res.status).toBe(201);
  });

  it("accepts the founder's web cookie session", async () => {
    mocks.cookie.value = await signSession(users["founder@example.com"]);
    const res = await POST(req(LUNCH, null));
    expect(res.status).toBe(201);
  });
});

describe("POST /api/calendar/events: validation", () => {
  const long = "x".repeat(301);
  const ID_ERROR = "id must be 5–1024 characters of a–v and 0–9";
  it.each([
    ["malformed JSON", "{not json", "body must be a JSON object"],
    ["an array", [LUNCH], "body must be a JSON object"],
    ["null", "null", "body must be a JSON object"],
    ["no title", { ...LUNCH, title: undefined }, "title required"],
    ["a blank title", { ...LUNCH, title: "   " }, "title required"],
    ["a non-string title", { ...LUNCH, title: 42 }, "title required"],
    ["a 301-character title", { ...LUNCH, title: long }, "title must be 300 characters or fewer"],
    ["a non-boolean allDay", { ...LUNCH, allDay: "yes" }, "allDay must be a boolean"],
    ["an unknown time zone", { ...LUNCH, timeZone: "Mars/Olympus_Mons" }, "timeZone must be an IANA time zone"],
    ["an offset for a time zone", { ...LUNCH, timeZone: "+05:00" }, "timeZone must be an IANA time zone"],
    ["a non-string time zone", { ...LUNCH, timeZone: -5 }, "timeZone must be an IANA time zone"],
    ["non-string notes", { ...LUNCH, notes: ["bring the deck"] }, "notes must be a string or null"],
    ["a 4-character id", { ...LUNCH, id: "abcd" }, ID_ERROR],
    ["a 1025-character id", { ...LUNCH, id: "a".repeat(1025) }, ID_ERROR],
    ["an id with a w", { ...LUNCH, id: "abcdw" }, ID_ERROR],
    ["an upper-case id", { ...LUNCH, id: "ABCDE" }, ID_ERROR],
    ["an id with a hyphen", { ...LUNCH, id: "6f1c2a0e-1234" }, ID_ERROR],
    ["an empty id", { ...LUNCH, id: "" }, ID_ERROR],
    ["a numeric id", { ...LUNCH, id: 12345 }, ID_ERROR],
    ["no start", { ...LUNCH, start: undefined }, "start and end must be RFC 3339 date-times"],
    ["a date for a timed event", { ...LUNCH, start: "2026-11-15", end: "2026-11-16" }, "start and end must be RFC 3339 date-times"],
    ["a date-time without an offset", { ...LUNCH, start: "2026-11-15T12:00:00" }, "start and end must be RFC 3339 date-times"],
    ["a date-time without seconds", { ...LUNCH, end: "2026-11-15T13:00-05:00" }, "start and end must be RFC 3339 date-times"],
    ["an impossible day", { ...LUNCH, start: "2026-02-30T12:00:00-05:00" }, "start and end must be RFC 3339 date-times"],
    ["hour 24", { ...LUNCH, end: "2026-11-15T24:00:00-05:00" }, "start and end must be RFC 3339 date-times"],
    ["a numeric start", { ...LUNCH, start: Date.parse(LUNCH.start) }, "start and end must be RFC 3339 date-times"],
    ["date-times for an all-day event", { ...LUNCH, allDay: true }, "start and end must be YYYY-MM-DD for an all-day event"],
    ["an impossible all-day date", { ...LUNCH, allDay: true, start: "2026-11-31", end: "2026-12-01" }, "start and end must be YYYY-MM-DD for an all-day event"],
    ["end equal to start", { ...LUNCH, end: LUNCH.start }, "end must be after start"],
    ["end before start in another offset", { ...LUNCH, end: "2026-11-15T16:30:00Z" }, "end must be after start"],
    ["an all-day end equal to start", { ...LUNCH, allDay: true, start: "2026-11-15", end: "2026-11-15" }, "end must be after start"],
    ["an all-day end before start", { ...LUNCH, allDay: true, start: "2026-11-15", end: "2026-11-14" }, "end must be after start"],
  ])("400s on %s", async (_label, body, error) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/calendar/events: insert", () => {
  it("creates a timed event on primary with sendUpdates=none and no invitees, and echoes Google's times", async () => {
    const res = await POST(
      req({
        title: "  Lunch with Erin Miles  ",
        start: "2026-11-15T17:00:00Z",
        end: "2026-11-15T18:00:00Z",
        allDay: false,
        timeZone: "America/New_York",
        notes: "  at Via Carota  ",
      }),
    );

    const { url, init, body } = googleCall();
    expect(url).toBe(GOOGLE_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    });
    expect(body).toEqual({
      summary: "Lunch with Erin Miles",
      description: "at Via Carota",
      start: { dateTime: "2026-11-15T17:00:00Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-11-15T18:00:00Z", timeZone: "America/New_York" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "evt123",
      htmlLink: "https://www.google.com/calendar/event?eid=evt123",
      title: "Lunch with Erin Miles",
      start: "2026-11-15T12:00:00-05:00",
      end: "2026-11-15T13:00:00-05:00",
      allDay: false,
      calendar: "primary",
    });
  });

  it("defaults the time zone to America/New_York and sends no description without notes", async () => {
    for (const extra of [{}, { notes: null, timeZone: null, allDay: null }, { notes: "   " }]) {
      mocks.fetch.mockClear();
      const res = await POST(req({ ...LUNCH, ...extra }));
      expect(res.status).toBe(201);
      expect(googleCall().body).toEqual({
        summary: "Lunch with Erin Miles",
        start: { dateTime: LUNCH.start, timeZone: "America/New_York" },
        end: { dateTime: LUNCH.end, timeZone: "America/New_York" },
      });
    }
  });

  it("sends the canonical zone name and upper-case T and Z", async () => {
    const res = await POST(
      req({ ...LUNCH, start: "2026-11-15t20:00:00.5z", end: "2026-11-15t21:00:00z", timeZone: "america/los_angeles" }),
    );
    expect(res.status).toBe(201);
    expect(googleCall().body).toMatchObject({
      start: { dateTime: "2026-11-15T20:00:00.5Z", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-11-15T21:00:00Z", timeZone: "America/Los_Angeles" },
    });
  });

  it("creates an all-day event with an exclusive end date and no time zone", async () => {
    mocks.fetch.mockImplementation(async () =>
      googleCreated({ summary: "Erin in town", start: { date: "2026-11-15" }, end: { date: "2026-11-16" } }),
    );
    const res = await POST(req({ title: "Erin in town", start: "2026-11-15", end: "2026-11-16", allDay: true }));

    const { url, body } = googleCall();
    expect(url).toBe(GOOGLE_URL);
    expect(body).toEqual({
      summary: "Erin in town",
      start: { date: "2026-11-15" },
      end: { date: "2026-11-16" },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      title: "Erin in town",
      start: "2026-11-15",
      end: "2026-11-16",
      allDay: true,
      calendar: "primary",
    });
  });
});

describe("POST /api/calendar/events: id (idempotent retries)", () => {
  // What ec sends: a UUID in base32hex, 26 characters.
  const ID = "c5h6ar3k1d0qg9v2m8tbe4lu7s";
  const EVENT_URL = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${ID}`;
  const duplicate = () =>
    googleReply(409, {
      error: { code: 409, message: "The requested identifier already exists.", errors: [{ domain: "global", reason: "duplicate" }] },
    });
  /** Google answers the insert with `insert`, then the GET of the event with `get`. */
  const google = (insert: () => Response, get: () => Response) =>
    mocks.fetch.mockImplementation(async (url: string) => (url === GOOGLE_URL ? insert() : get()));

  it("passes the id to Google as the event's id and answers 201", async () => {
    mocks.fetch.mockImplementation(async () => googleCreated({ id: ID }));
    const res = await POST(req({ ...LUNCH, id: ID }));
    const { url, body } = googleCall();
    expect(url).toBe(GOOGLE_URL);
    expect(body).toEqual({
      id: ID,
      summary: "Lunch with Erin Miles",
      start: { dateTime: LUNCH.start, timeZone: "America/New_York" },
      end: { dateTime: LUNCH.end, timeZone: "America/New_York" },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: ID, calendar: "primary" });
  });

  it("takes ids of 5 and 1024 characters, and a null id as none", async () => {
    for (const id of ["0a1b2", "v".repeat(1024)]) {
      mocks.fetch.mockClear();
      expect((await POST(req({ ...LUNCH, id }))).status).toBe(201);
      expect(googleCall().body.id).toBe(id);
    }
    mocks.fetch.mockClear();
    expect((await POST(req({ ...LUNCH, id: null }))).status).toBe(201);
    expect(googleCall().body).not.toHaveProperty("id");
  });

  it("answers 200 with the stored event when Google already has the id, without a second insert", async () => {
    google(duplicate, () =>
      googleCreated({
        id: ID,
        htmlLink: `https://www.google.com/calendar/event?eid=${ID}`,
        status: "confirmed",
        start: { dateTime: "2026-11-15T12:00:00-05:00", timeZone: "America/New_York" },
      }),
    );
    const res = await POST(req({ ...LUNCH, id: ID }));

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const [[insertUrl, insert], [getUrl, get]] = mocks.fetch.mock.calls as [string, RequestInit][];
    expect([insertUrl, insert.method]).toEqual([GOOGLE_URL, "POST"]);
    expect(JSON.parse(insert.body as string).id).toBe(ID);
    expect(getUrl).toBe(EVENT_URL);
    expect(get.method ?? "GET").toBe("GET");
    expect(get.headers).toEqual({ Authorization: `Bearer ${ACCESS_TOKEN}` });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: ID,
      htmlLink: `https://www.google.com/calendar/event?eid=${ID}`,
      title: "Lunch with Erin Miles",
      start: "2026-11-15T12:00:00-05:00",
      end: "2026-11-15T13:00:00-05:00",
      allDay: false,
      calendar: "primary",
    });
    expect(quiet).not.toHaveBeenCalled();
  });

  it("502s when the existing event can't be read", async () => {
    google(duplicate, () => googleReply(404, { error: { code: 404, message: "Not Found" } }));
    const res = await POST(req({ ...LUNCH, id: ID }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Google Calendar didn't accept the event.", detail: "409, then 404 Not Found" });
  });

  it("502s when the id belongs to a deleted event, rather than reporting it added", async () => {
    google(duplicate, () => googleCreated({ id: ID, status: "cancelled" }));
    const res = await POST(req({ ...LUNCH, id: ID }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Google Calendar didn't accept the event.",
      detail: `409, and event ${ID} was deleted`,
    });
  });

  it("treats a 409 without an id as Google's refusal, and never looks anything up", async () => {
    mocks.fetch.mockImplementation(async () => duplicate());
    const res = await POST(req(LUNCH));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Google Calendar didn't accept the event.",
      detail: "409 The requested identifier already exists.",
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});

describe("POST /api/calendar/events: Google failures", () => {
  const logged = () => quiet.mock.calls.flat().map(String).join("\n");

  it("502s on a Google 5xx with its status and message, without logging the token", async () => {
    mocks.fetch.mockImplementation(async () =>
      googleReply(503, { error: { code: 503, message: "The service is currently unavailable.", errors: [] } }),
    );
    const res = await POST(req(LUNCH));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Google Calendar didn't accept the event.",
      detail: "503 The service is currently unavailable.",
    });
    expect(logged()).toContain("503 The service is currently unavailable.");
    expect(logged()).not.toContain(ACCESS_TOKEN);
  });

  it("keeps a non-JSON error body short", async () => {
    mocks.fetch.mockImplementation(async () => googleReply(500, `<html>${"x".repeat(1000)}</html>`));
    const res = await POST(req(LUNCH));
    expect(res.status).toBe(502);
    const { detail } = await res.json();
    expect(detail).toMatch(/^500 <html>x+…$/);
    expect(detail.length).toBeLessThanOrEqual(201);
  });

  it("502s when the token refresh fails, without calling the Calendar API", async () => {
    mocks.accessToken.mockRejectedValue(
      new Error('Google token refresh failed (400): {"error": "invalid_grant"}'),
    );
    const res = await POST(req(LUNCH));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Google Calendar didn't accept the event.",
      detail: 'Google token refresh failed (400): {"error": "invalid_grant"}',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("502s when the request to Google throws", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    const res = await POST(req(LUNCH));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Google Calendar didn't accept the event.", detail: "fetch failed" });
    expect(logged()).not.toContain(ACCESS_TOKEN);
  });
});
