// End to end through collectSignals → inferProjects → the store, with every
// edge mocked: the database, Gmail, Calendar, Granola and Claude.
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  db: {
    datingPerson: { findMany: vi.fn() },
    person: { findMany: vi.fn() },
    datingEvent: { findMany: vi.fn() },
    datingSuggestion: { findMany: vi.fn() },
    datingSourceRecord: { findMany: vi.fn() },
    todo: { findMany: vi.fn() },
    note: { findMany: vi.fn() },
    projectSource: {
      createMany: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  claude: vi.fn(),
  listThreads: vi.fn(),
  getThreadMeta: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: m.db }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: m.claude }));
vi.mock("@/lib/google", () => ({
  isGoogleConfigured: () => true,
  getGmailAddresses: async () => ({ account: "me@im.example", addresses: ["me@im.example"] }),
  listThreads: m.listThreads,
  getThreadMeta: m.getThreadMeta,
  getGoogleAccessToken: async () => "t",
}));
import { collectSignals } from "./signals";
import type { CalendarEvent } from "./signals/meetings";
import { syncInferredProjects } from "./sync";
import type { GranolaClient, GranolaNote } from "@/lib/granola";

const NOW = new Date("2026-10-27T18:00:00Z");
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86400_000).toISOString();
const ME = { email: "me@im.example", self: true, responseStatus: "accepted" as const };

const event = (id: string, summary: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  status: "confirmed",
  summary,
  start: { dateTime: at(2) },
  htmlLink: `https://calendar.google.com/event?eid=${id}`,
  attendees: [ME, { email: "ops@vendor.example" }],
  ...over,
});
const EVENTS: CalendarEvent[] = [
  event("work", "ERP cutover review"),
  event("upcoming", "Product launch sync", { start: { dateTime: at(-2) } }),
  event("therapy", "Therapy"),
  event("private", "Quiet meeting", { visibility: "private" }),
  event("handle", "Coffee", { attendees: [ME, { email: "crush@example.invalid" }] }),
  event("family", "Dinner with Mom"),
];

const summary = (id: string, title: string) => ({ id, title, created_at: at(3), updated_at: at(3), owner: { name: "Me", email: "me@im.example" } });
const NOTES = [summary("not_therapy", "Therapy"), summary("not_drinks", "Catch-up"), summary("not_work", "Launch planning"), summary("not_filed", "Walk")];
const full = (id: string, title: string, text: string): GranolaNote => ({
  ...summary(id, title),
  web_url: `https://notes.granola.ai/d/${id}`,
  calendar_event: null,
  attendees: [{ name: "Ops", email: "ops@vendor.example" }],
  summary_text: text,
  summary_markdown: null,
  private_notes_text: null,
  private_notes_markdown: null,
  transcript: null,
});
const FULL: Record<string, GranolaNote> = {
  not_drinks: full("not_drinks", "Catch-up", "Talked about Jordan and the weekend"),
  not_work: full("not_work", "Launch planning", "Pricing and launch checklist"),
  not_filed: full("not_filed", "Walk", "Nothing much"),
};
const granola = (): GranolaClient & { getNote: ReturnType<typeof vi.fn> } => ({
  listNotes: vi.fn().mockResolvedValue(NOTES),
  getNote: vi.fn(async (id: string) => FULL[id]),
});

const header = (Subject: string, To: string) => ({
  id: "1",
  internalDate: String(Date.parse(at(1))),
  snippet: "",
  payload: { headers: [{ name: "Subject", value: Subject }, { name: "From", value: "me@im.example" }, { name: "To", value: To }] },
});
const THREADS: Record<string, { id: string; messages: ReturnType<typeof header>[] }> = {
  t1: { id: "t1", messages: [header("Lender term sheet", "cap@lender.example")] },
  t2: { id: "t2", messages: [header("Dentist appointment", "front@clinic.example")] },
};

const PRIVATE_STRINGS = ["Therapy", "Quiet meeting", "Coffee", "Mom", "Jordan", "Catch-up", "Walk", "Dentist", "homework", "Grandma", "dating-note"];

let g: ReturnType<typeof granola>;
const collect: typeof collectSignals = (userId, opts) => collectSignals(userId, { ...opts, granola: g, listEvents: async () => EVENTS });

beforeEach(() => {
  vi.clearAllMocks();
  g = granola();
  m.db.datingPerson.findMany.mockResolvedValue([{ name: "Jordan Vale", handles: ["crush@example.invalid", "+15550000000"] }]);
  m.db.person.findMany.mockResolvedValue([]);
  m.db.datingEvent.findMany.mockResolvedValue([{ externalId: "granola:not_filed:person1" }]);
  m.db.datingSuggestion.findMany.mockResolvedValue([]);
  m.db.datingSourceRecord.findMany.mockResolvedValue([]);
  m.db.todo.findMany.mockResolvedValue([
    { id: "td1", title: "Ship ERP cutover", notes: null, updatedAt: new Date(at(1)), completedAt: null, autopilotKey: null, project: null },
    { id: "td2", title: "Do the homework", notes: null, updatedAt: new Date(at(1)), completedAt: null, autopilotKey: "granola:not_therapy:0", project: null },
    { id: "td3", title: "Oil change", notes: null, updatedAt: new Date(at(1)), completedAt: null, autopilotKey: "vehicle:x:oil", project: null },
    {
      id: "td4",
      title: "Refill",
      notes: null,
      updatedAt: new Date(at(1)),
      completedAt: null,
      autopilotKey: null,
      project: { id: "h", name: "Me", kind: "human", human: { id: "h1" }, pet: null },
    },
  ]);
  m.db.note.findMany.mockResolvedValue([
    { id: "n1", title: "Grandma visit", body: "", updatedAt: new Date(at(1)), project: { id: "p", name: "Misc", kind: "generic", human: null, pet: null } },
    { id: "n2", title: "Pricing ideas", body: "tiers", updatedAt: new Date(at(1)), project: { id: "p", name: "Misc", kind: "generic", human: null, pet: null } },
    { id: "n3", title: "dating-note", body: "", updatedAt: new Date(at(1)), project: { id: "j", name: "Journal", kind: "generic", human: null, pet: null } },
  ]);
  m.listThreads.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
  m.getThreadMeta.mockImplementation(async (id: string) => THREADS[id]);

  const ps = m.db.projectSource;
  ps.updateMany.mockResolvedValue({ count: 1 });
  ps.findMany.mockResolvedValue([]);
  ps.findUnique.mockResolvedValue({ plan: {} });
  ps.upsert.mockImplementation((args) => ({ op: "upsert", args }));
  ps.deleteMany.mockImplementation((args) => ({ op: "deleteMany", args }));
  ps.update.mockImplementation((args) => ({ op: "update", args }));
  m.db.$transaction.mockImplementation(async (ops: unknown[]) => ops);
  m.claude.mockImplementation(async () => ({
    projects: [{ key: null, name: "ERP migration", company: "Olto", status: "Cutover planned", next: "Review on Tuesday", evidence: ["m1", "t1"] }],
  }));
});

describe("syncInferredProjects", () => {
  it("never shows Claude a dating, therapy, family, health or private item", async () => {
    const res = await syncInferredProjects("u1", { now: NOW, collect });
    expect(res.status).toBe("ok");
    const prompt = m.claude.mock.calls[0][0].user as string;
    for (const s of PRIVATE_STRINGS) expect(prompt).not.toContain(s);
    for (const s of ["ERP cutover review", "Product launch sync", "Launch planning", "Lender term sheet", "Ship ERP cutover", "Pricing ideas"]) {
      expect(prompt).toContain(s);
    }
    // A therapy note is gated on its title and never fetched.
    expect(g.getNote).not.toHaveBeenCalledWith("not_therapy");
    expect(g.getNote).not.toHaveBeenCalledWith("not_filed");
    if (res.status !== "ok") throw new Error();
    expect(res.excluded).toMatchObject({
      therapy: 2,
      private: 1,
      contact: 1,
      family: 2,
      dating: 1,
      health: 1,
      "dating-record": 1,
      "excluded-meeting": 1,
    });
    expect(res.counts).toMatchObject({ calendarEvents: 6, granolaNotes: 4, gmailThreads: 2, meetings: 3, emails: 1, todoItems: 1, noteItems: 1 });
    expect(m.db.$transaction).toHaveBeenCalledOnce();
    expect(m.db.projectSource.upsert.mock.calls[0][0].create).toMatchObject({ key: "erp-migration", name: "ERP migration" });
  });

  it("writes no projects when a source fails, and records the failure class", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    m.listThreads.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const res = await syncInferredProjects("u1", { now: NOW, collect });
    expect(res).toMatchObject({ status: "failed", error: "gmail: HTTP 500" });
    expect(m.claude).not.toHaveBeenCalled();
    expect(m.db.$transaction).not.toHaveBeenCalled();
    expect(m.db.projectSource.upsert).not.toHaveBeenCalled();
    expect(m.db.projectSource.deleteMany).not.toHaveBeenCalled();
    expect(m.db.projectSource.update.mock.calls[0][0].data).toMatchObject({ state: "idle", plan: { error: "gmail: HTTP 500" } });
    expect(err.mock.calls.flat().join(" ")).not.toContain("boom");
    err.mockRestore();
  });

  it("writes no projects when Claude fails or replies with junk", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    m.claude.mockRejectedValueOnce(Object.assign(new Error("overloaded"), { status: 529 }));
    expect(await syncInferredProjects("u1", { now: NOW, collect })).toMatchObject({ status: "failed", error: "claude: HTTP 529" });
    m.claude.mockResolvedValueOnce({ nothing: true });
    expect(await syncInferredProjects("u1", { now: NOW, collect })).toMatchObject({ status: "failed", error: "claude: validation" });
    expect(m.db.$transaction).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("returns busy without collecting when another run holds the lock", async () => {
    m.db.projectSource.updateMany.mockResolvedValueOnce({ count: 0 });
    const spy = vi.fn();
    expect(await syncInferredProjects("u1", { now: NOW, collect: spy })).toEqual({ status: "busy" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips Claude when the evidence hasn't changed since a recent success", async () => {
    await syncInferredProjects("u1", { now: NOW, collect });
    const meta = m.db.projectSource.update.mock.calls.at(-1)![0].data.plan;
    m.db.projectSource.findMany.mockResolvedValue([{ id: "r", kind: "inferred-run", key: "latest", plan: meta }]);
    m.claude.mockClear();
    const res = await syncInferredProjects("u1", { now: new Date(NOW.getTime() + 3600_000), collect });
    expect(res).toMatchObject({ status: "unchanged", projects: 1 });
    expect(m.claude).not.toHaveBeenCalled();
  });
});
