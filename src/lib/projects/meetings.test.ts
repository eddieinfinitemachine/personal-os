import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  meetingFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  sourceFindMany: vi.fn(),
  claude: vi.fn(),
  people: vi.fn(),
  googleConfigured: vi.fn(),
  listEvents: vi.fn(),
  fromEnv: vi.fn(),
  listNotes: vi.fn(),
  getNote: vi.fn(),
  tx: {
    projectMeeting: { deleteMany: vi.fn(), upsert: vi.fn(), count: vi.fn() },
    projectSource: { upsert: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectMeeting: { findMany: mocks.meetingFindMany },
    project: { findMany: mocks.projectFindMany },
    projectSource: { findMany: mocks.sourceFindMany },
    $transaction: (fn: (tx: unknown) => unknown) => fn(mocks.tx),
  },
}));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
vi.mock("@/lib/dating-filer", () => ({ loadKnownPeople: mocks.people }));
vi.mock("@/lib/google", () => ({ isGoogleConfigured: mocks.googleConfigured }));
vi.mock("./calendar", () => ({ listPrimaryEvents: mocks.listEvents }));
vi.mock("@/lib/granola", async (orig) => ({ ...(await orig<typeof import("@/lib/granola")>()), granolaFromEnv: mocks.fromEnv }));
import { syncMeetingProjects, validateDecisions } from "./meetings";

const NOW = new Date("2026-10-27T18:00:00Z");
const REPO_SYNCED = new Date("2026-10-27T17:00:00Z");
const at = (daysAgo: number, hour = 15) => {
  const d = new Date(NOW.getTime() - daysAgo * 86400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const event = (id: string, summary: string, start: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "confirmed",
  summary,
  start: { dateTime: start },
  end: { dateTime: start },
  htmlLink: `https://calendar.google.com/event?eid=${id}`,
  attendees: [
    { email: "emcohen@me.com", self: true, responseStatus: "accepted" },
    { email: "pat@acme.com", responseStatus: "accepted" },
  ],
  ...over,
});

const noteSummary = (id: string, title: string, created: string) => ({
  id,
  title,
  created_at: created,
  updated_at: created,
  owner: { name: "Eddie", email: "emcohen@me.com" },
});
const fullNote = (id: string, title: string, created: string, summary: string, ce?: { event_title: string; scheduled_start_time: string }) => ({
  ...noteSummary(id, title, created),
  web_url: `https://notes.granola.ai/d/${id}`,
  calendar_event: ce ?? null,
  attendees: [{ name: "Pat", email: "pat@acme.com" }],
  summary_text: summary,
  summary_markdown: null,
  private_notes_text: null,
  private_notes_markdown: null,
  transcript: null,
});

type Stored = { externalKey: string; sourceId: string | null; projectId: string | null; title: string | null; occurredAt: Date };
let stored: Stored[];
let notes: ReturnType<typeof noteSummary>[];
let fullNotes: Record<string, ReturnType<typeof fullNote>>;
let topics: { id: string; key: string; name: string; company: string; state: string; projectId: string | null }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("FOUNDER_EMAIL", "emcohen@me.com");
  vi.stubEnv("GRANOLA_OWNER_EMAIL", "");
  stored = [];
  notes = [];
  fullNotes = {};
  topics = [];
  mocks.googleConfigured.mockReturnValue(true);
  mocks.listEvents.mockResolvedValue([]);
  mocks.fromEnv.mockReturnValue({ listNotes: mocks.listNotes, getNote: mocks.getNote });
  mocks.listNotes.mockImplementation(async () => notes);
  mocks.getNote.mockImplementation(async (id: string) => fullNotes[id]);
  mocks.meetingFindMany.mockImplementation(async ({ where }: { where: { externalKey: { in: string[] } } }) =>
    stored.filter((s) => where.externalKey.in.includes(s.externalKey)).map((s) => ({ externalKey: s.externalKey })),
  );
  mocks.people.mockResolvedValue([{ name: "Ana Lopez" }]);
  mocks.projectFindMany.mockResolvedValue([
    { id: "p_inbox", name: "Inbox" },
    { id: "p_journal", name: "Journal" },
    { id: "p_fleet", name: "Fleet pilot" },
  ]);
  mocks.sourceFindMany.mockImplementation(async ({ where }: { where: { kind: string } }) =>
    where.kind === "repo"
      ? [{ id: "s_rush", key: "edcohen/rushmore", name: "rushmore", company: "Personal", description: "Booking app", syncedAt: REPO_SYNCED }]
      : topics,
  );
  mocks.claude.mockResolvedValue({ meetings: [] });
  mocks.tx.projectMeeting.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.projectMeeting.upsert.mockImplementation(async ({ create }: { create: Stored }) => {
    stored.push({ ...create, occurredAt: new Date(create.occurredAt) });
    return create;
  });
  mocks.tx.projectMeeting.count.mockImplementation(async ({ where }: { where: { sourceId: string } }) =>
    stored.filter((s) => s.sourceId === where.sourceId).length,
  );
  mocks.tx.projectSource.upsert.mockImplementation(async ({ create }: { create: { key: string; name: string; company: string; state: string } }) => {
    const row = { id: `t_${create.key}`, key: create.key, name: create.name, company: create.company, state: create.state, projectId: null };
    topics.push(row);
    return row;
  });
  mocks.tx.projectSource.updateMany.mockResolvedValue({ count: 1 });
});

const prompt = () => mocks.claude.mock.calls.map((c) => `${c[0].system}\n${c[0].user}`).join("\n");

describe("syncMeetingProjects", () => {
  it("keeps therapy and dating meetings (titles and summaries) out of the Claude prompt", async () => {
    mocks.listEvents.mockResolvedValue([
      event("e1", "Therapy", at(2)),
      event("e2", "Block", at(3)),
      event("e3", "Dinner with Ana", at(4)),
      event("e4", "Coffee date", at(5)),
      event("e5", "Fleet pilot sync", at(6)),
      event("e6", "Private thing", at(7), { visibility: "private" }),
    ]);
    notes = [noteSummary("n1", "Catch-up", at(1)), noteSummary("n2", "Weekly GTM", at(1, 17))];
    fullNotes = {
      n1: fullNote("n1", "Catch-up", at(1), "We talked about my Hinge matches and the ex"),
      n2: fullNote("n2", "Weekly GTM", at(1, 17), "Pipeline review for the fleet pilot"),
    };
    const res = await syncMeetingProjects("u1", { now: NOW });
    const p = prompt();
    for (const secret of ["Therapy", "Block", "Ana", "Coffee date", "Hinge", "Catch-up", "Private thing"]) {
      expect(p).not.toContain(secret);
    }
    expect(p).toContain("Fleet pilot sync");
    expect(p).toContain("Pipeline review");
    expect(res.excluded).toBe(6);
    // Excluded meetings are stored (never re-read) with no title and no link.
    const excluded = stored.filter((s) => ["gcal:e1", "gcal:e2", "gcal:e3", "gcal:e4", "gcal:e6", "granola:n1"].includes(s.externalKey));
    expect(excluded).toHaveLength(6);
    for (const row of excluded) expect(row).toMatchObject({ title: null, sourceId: null, projectId: null });
  });

  it("only sends real meetings: timed, not declined, with someone else", async () => {
    mocks.listEvents.mockResolvedValue([
      event("solo", "Focus block", at(2), { attendees: [{ email: "emcohen@me.com", self: true }] }),
      event("noattendees", "Gym", at(2), { attendees: undefined }),
      event("allday", "Offsite", at(2), { start: { date: "2026-10-25" } }),
      event("declined", "Board prep", at(2), {
        attendees: [{ email: "emcohen@me.com", self: true, responseStatus: "declined" }, { email: "x@acme.com" }],
      }),
      event("room", "Room only", at(2), { attendees: [{ email: "emcohen@me.com", self: true }, { email: "room@resource.calendar.google.com", resource: true }] }),
      event("cancelled", "Cancelled sync", at(2), { status: "cancelled" }),
      event("ok", "Acme intro", at(2)),
    ]);
    await syncMeetingProjects("u1", { now: NOW });
    const p = prompt();
    expect(p).toContain("gcal:ok");
    expect(p).toContain("Attendee domains: acme.com");
    for (const k of ["solo", "noattendees", "allday", "declined", "room", "cancelled"]) expect(p).not.toContain(`gcal:${k}`);
  });

  it("lets a Granola note replace the calendar event of the same meeting", async () => {
    mocks.listEvents.mockResolvedValue([
      event("e1", "Acme intro", at(2, 15)),
      event("e2", "Acme intro", at(9, 15)), // same title, different day: kept
    ]);
    notes = [noteSummary("n1", "Acme intro", new Date(Date.parse(at(2, 15)) + 4 * 60_000).toISOString())];
    fullNotes = { n1: fullNote("n1", "Acme intro", notes[0].created_at, "Discussed the pilot") };
    await syncMeetingProjects("u1", { now: NOW });
    const p = prompt();
    expect(p).toContain("granola:n1");
    expect(p).not.toContain("gcal:e1");
    expect(p).toContain("gcal:e2");
  });

  it("deletes an already-stored calendar row when its Granola note arrives later", async () => {
    stored.push({ externalKey: "gcal:e1", sourceId: null, projectId: null, title: null, occurredAt: new Date(at(2)) });
    mocks.listEvents.mockResolvedValue([event("e1", "Quarterly review", at(2))]);
    notes = [noteSummary("n1", "Untitled", at(2, 16))];
    fullNotes = {
      n1: fullNote("n1", "Untitled", at(2, 16), "Numbers", { event_title: "Quarterly review", scheduled_start_time: at(2) }),
    };
    mocks.tx.projectMeeting.deleteMany.mockResolvedValue({ count: 1 });
    const res = await syncMeetingProjects("u1", { now: NOW });
    expect(mocks.tx.projectMeeting.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", externalKey: { in: ["gcal:e1"] } } });
    expect(res.replaced).toBe(1);
    expect(prompt()).toContain("granola:n1");
  });

  it("links matches, drops invalid match keys, and stores unlinked meetings with no title", async () => {
    mocks.listEvents.mockResolvedValue([
      event("e1", "Fleet pilot sync", at(2)),
      event("e2", "Rushmore booking flow", at(3)),
      event("e3", "Investor update", at(4)),
      event("e4", "Team lunch", at(5)),
    ]);
    mocks.claude.mockResolvedValue({
      meetings: [
        { externalKey: "gcal:e1", match: "project:p_fleet", topic: null, company: "Infinite Machine", personal: false },
        { externalKey: "gcal:e2", match: "repo:edcohen/rushmore", topic: null, company: "Personal", personal: false },
        { externalKey: "gcal:e3", match: "project:p_made_up", topic: null, company: null, personal: false },
        { externalKey: "gcal:e4", match: "project:p_fleet", topic: null, company: null, personal: true },
      ],
    });
    const res = await syncMeetingProjects("u1", { now: NOW });
    const by = Object.fromEntries(stored.map((s) => [s.externalKey, s]));
    expect(by["gcal:e1"]).toMatchObject({ title: "Fleet pilot sync", projectId: "p_fleet", sourceId: null });
    expect(by["gcal:e2"]).toMatchObject({ title: "Rushmore booking flow", sourceId: "s_rush" });
    expect(by["gcal:e3"]).toMatchObject({ title: null, projectId: null, sourceId: null });
    expect(by["gcal:e4"]).toMatchObject({ title: null, projectId: null, sourceId: null });
    expect(res).toMatchObject({ processed: 4, linked: 2, unlinked: 2, excluded: 0 });
    // Inbox and Journal are not cards; the repo's activity moved forward.
    expect(prompt()).not.toContain("project:p_inbox");
    expect(prompt()).not.toContain("project:p_journal");
    expect(mocks.tx.projectSource.updateMany).toHaveBeenCalledWith({
      where: { id: "s_rush", OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: new Date(at(3)) } }] },
      // The repo's syncedAt ("Synced …" on /projects) is the GitHub sync's, not ours.
      data: { lastActivityAt: new Date(at(3)), syncedAt: REPO_SYNCED },
    });
  });

  it("makes a new topic a candidate, then suggested at the second meeting", async () => {
    mocks.listEvents.mockResolvedValue([event("e1", "Series A prep", at(5))]);
    mocks.claude.mockResolvedValue({
      meetings: [{ externalKey: "gcal:e1", match: null, topic: "Series A", company: "Infinite Machine", personal: false }],
    });
    let res = await syncMeetingProjects("u1", { now: NOW });
    expect(res.topicsCreated).toEqual(["Series A"]);
    expect(res.topicsSuggested).toEqual([]);
    expect(mocks.tx.projectSource.upsert.mock.calls[0][0].create).toMatchObject({
      kind: "topic",
      key: "series-a",
      state: "candidate",
      company: "Infinite Machine",
    });
    expect(stored[0]).toMatchObject({ sourceId: "t_series-a", title: "Series A prep" });

    // Next run: a second meeting on the same topic (Claude names it slightly differently).
    mocks.listEvents.mockResolvedValue([event("e1", "Series A prep", at(5)), event("e2", "Series A: lead investor", at(1))]);
    mocks.claude.mockResolvedValue({
      meetings: [{ externalKey: "gcal:e2", match: null, topic: "series a", company: null, personal: false }],
    });
    res = await syncMeetingProjects("u1", { now: NOW });
    expect(prompt()).toContain("topic:series-a");
    expect(res.topicsCreated).toEqual([]);
    expect(res.topicsSuggested).toEqual(["Series A"]);
    expect(mocks.tx.projectSource.updateMany).toHaveBeenCalledWith({
      where: { id: "t_series-a", state: "candidate" },
      data: { state: "suggested" },
    });
  });

  it("never resurrects a dismissed topic and links nothing visible to it", async () => {
    topics = [{ id: "t_old", key: "old-deal", name: "Old deal", company: "Personal", state: "dismissed", projectId: null }];
    mocks.listEvents.mockResolvedValue([event("e1", "Old deal again", at(1)), event("e2", "Old deal more", at(2))]);
    mocks.claude.mockResolvedValue({
      meetings: [
        { externalKey: "gcal:e1", match: "topic:old-deal", topic: null, company: null, personal: false },
        { externalKey: "gcal:e2", match: null, topic: "Old Deal", company: null, personal: false },
      ],
    });
    const res = await syncMeetingProjects("u1", { now: NOW });
    expect(prompt()).toContain("topic:old-deal"); // dismissed topics are still known cards
    expect(stored.map((s) => s.sourceId)).toEqual([null, null]);
    expect(stored.map((s) => s.title)).toEqual([null, null]);
    expect(mocks.tx.projectSource.upsert).not.toHaveBeenCalled();
    expect(res.topicsSuggested).toEqual([]);
    expect(mocks.tx.projectSource.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { state: "suggested" } }));
  });

  it("links a meeting on an accepted topic to its Project", async () => {
    topics = [{ id: "t_acc", key: "fleet-deal", name: "Fleet deal", company: "Infinite Machine", state: "accepted", projectId: "p_new" }];
    mocks.listEvents.mockResolvedValue([event("e1", "Fleet deal", at(1))]);
    mocks.claude.mockResolvedValue({ meetings: [{ externalKey: "gcal:e1", match: "topic:fleet-deal", personal: false }] });
    await syncMeetingProjects("u1", { now: NOW });
    expect(stored[0]).toMatchObject({ sourceId: "t_acc", projectId: "p_new", title: "Fleet deal" });
  });

  it("skips meetings already processed, and classifies at most 40 per run, oldest first", async () => {
    stored.push({ externalKey: "gcal:old", sourceId: null, projectId: null, title: null, occurredAt: new Date(at(10)) });
    mocks.listEvents.mockResolvedValue([
      event("old", "Seen before", at(10)),
      ...Array.from({ length: 45 }, (_, i) => event(`m${i}`, `Meeting ${i}`, new Date(Date.parse(at(9)) + i * 3600_000).toISOString())),
    ]);
    const res = await syncMeetingProjects("u1", { now: NOW });
    const p = prompt();
    expect(p).not.toContain("gcal:old");
    expect(p).toContain("gcal:m0\n");
    expect(p).toContain("gcal:m39\n");
    expect(p).not.toContain("gcal:m40\n");
    expect(res.deferred).toBe(5);
  });

  it("writes nothing for classified meetings when Claude fails (so they retry), but still stores excluded ones", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listEvents.mockResolvedValue([event("e1", "Therapy", at(1)), event("e2", "Acme intro", at(2))]);
    mocks.claude.mockRejectedValue(Object.assign(new Error("Claude error 529: overloaded"), { status: 529 }));
    const res = await syncMeetingProjects("u1", { now: NOW });
    expect(stored.map((s) => s.externalKey)).toEqual(["gcal:e1"]);
    expect(res.errors).toEqual(["classify: HTTP 529"]);
    expect(spy.mock.calls.flat().join(" ")).not.toContain("Acme");
    spy.mockRestore();
  });

  it("skips Granola notes owned by someone else when GRANOLA_OWNER_EMAIL is set", async () => {
    vi.stubEnv("GRANOLA_OWNER_EMAIL", "emcohen@me.com");
    mocks.googleConfigured.mockReturnValue(false);
    notes = [noteSummary("n1", "Mine", at(1)), { ...noteSummary("n2", "Shared with me", at(1)), owner: { name: "O", email: "o@x.com" } }];
    fullNotes = { n1: fullNote("n1", "Mine", at(1), "s") };
    await syncMeetingProjects("u1", { now: NOW });
    expect(mocks.getNote).toHaveBeenCalledTimes(1);
    expect(mocks.listEvents).not.toHaveBeenCalled();
    expect(prompt()).not.toContain("Shared with me");
  });
});

describe("syncMeetingProjects source failures", () => {
  it("carries on with Granola when the calendar listing fails, logging no titles", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listEvents.mockRejectedValue(Object.assign(new Error("Google Calendar list events failed (403)"), { status: 403 }));
    notes = [noteSummary("n1", "Acme intro", at(1))];
    fullNotes = { n1: fullNote("n1", "Acme intro", at(1), "Pilot") };
    const res = await syncMeetingProjects("u1", { now: NOW });
    expect(res.errors).toEqual(["calendar: HTTP 403"]);
    expect(prompt()).toContain("granola:n1");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("Acme");
    spy.mockRestore();
  });

  it("carries on with the calendar when Granola fails, and fails the run only when every source does", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listNotes.mockRejectedValue(Object.assign(new Error("Granola 500"), { status: 500 }));
    mocks.listEvents.mockResolvedValue([event("e1", "Acme intro", at(2))]);
    const res = await syncMeetingProjects("u1", { now: NOW });
    expect(res.errors).toEqual(["granola: HTTP 500"]);
    expect(prompt()).toContain("gcal:e1");

    mocks.listEvents.mockRejectedValue(Object.assign(new Error("x"), { status: 503 }));
    await expect(syncMeetingProjects("u1", { now: NOW })).rejects.toThrow(/every meeting source failed/);
    spy.mockRestore();
  });

  it("keeps a stored calendar row when the note replacing it isn't written (classification failed)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    stored.push({ externalKey: "gcal:e1", sourceId: null, projectId: null, title: null, occurredAt: new Date(at(2)) });
    mocks.listEvents.mockResolvedValue([event("e1", "Quarterly review", at(2)), event("e2", "Therapy", at(3))]);
    notes = [noteSummary("n1", "Quarterly review", at(2, 15))];
    fullNotes = { n1: fullNote("n1", "Quarterly review", at(2, 15), "Numbers") };
    mocks.claude.mockRejectedValue(Object.assign(new Error("overloaded"), { status: 529 }));
    const res = await syncMeetingProjects("u1", { now: NOW });
    // The excluded therapy event is still written, but the gcal row survives.
    expect(stored.map((s) => s.externalKey)).toEqual(["gcal:e1", "gcal:e2"]);
    expect(mocks.tx.projectMeeting.deleteMany).not.toHaveBeenCalled();
    expect(res.replaced).toBe(0);
    spy.mockRestore();
  });
});

describe("validateDecisions", () => {
  it("drops unknown meetings and non-card matches, and folds a known topic name into a match", () => {
    const out = validateDecisions(
      {
        meetings: [
          { externalKey: "gcal:a", match: "repo:nope/nope", topic: null, company: "Olto" },
          { externalKey: "gcal:b", match: null, topic: "Series A", company: "Nonsense" },
          { externalKey: "gcal:zzz", match: "project:p1" },
          { externalKey: "gcal:c", match: null, topic: "!!!" },
        ],
      },
      new Set(["gcal:a", "gcal:b", "gcal:c"]),
      new Set(["project:p1", "topic:series-a"]),
    );
    expect(out.get("gcal:a")).toEqual({ match: null, topic: null, company: "Olto" });
    expect(out.get("gcal:b")).toEqual({ match: "topic:series-a", topic: null, company: null });
    expect(out.get("gcal:c")).toEqual({ match: null, topic: null, company: null });
    expect(out.has("gcal:zzz")).toBe(false);
    expect(validateDecisions("garbage", new Set(), new Set()).size).toBe(0);
  });
});
