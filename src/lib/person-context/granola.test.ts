import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GranolaClient, GranolaNote } from "@/lib/granola";
import { granolaMeetingsForPerson, resetPersonGranolaCache } from "./granola";
import { CONTEXT_LIMITS } from "./types";

const now = new Date("2026-09-29T12:00:00Z");
const note = (id: string, created: string, title: string, extra: Partial<GranolaNote> = {}): GranolaNote => ({
  id, title, owner: { name: null, email: "me@example.com" }, created_at: created, updated_at: created, web_url: "",
  calendar_event: null, attendees: [], summary_text: "", summary_markdown: null, private_notes_text: null,
  private_notes_markdown: null, transcript: [{ speaker: { source: "x" }, text: "transcript secret" }], ...extra,
});
const notes = [
  note("n1", "2026-09-01T00:00:00Z", "Sync with Sample Contact"),
  note("n2", "2026-08-01T00:00:00Z", "Weekly", { attendees: [{ name: "sample contact", email: "s@example.com" }] }),
  note("n3", "2026-07-01T00:00:00Z", "Planning", { summary_text: "Discussed Sample Contactless payments" }),
  note("n4", "2026-06-01T00:00:00Z", "Planning", { summary_text: "Sample said hi" }),
  note("old", "2025-01-01T00:00:00Z", "Sample Contact"),
];
const client = (list: GranolaNote[] = notes, delayMs = 0): GranolaClient & { listNotes: ReturnType<typeof vi.fn>; getNote: ReturnType<typeof vi.fn> } => ({
  listNotes: vi.fn(async () => list),
  getNote: vi.fn(async (id: string) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return list.find((n) => n.id === id)!;
  }),
});
// `count` unrelated notes, newest first, one hour apart starting just before `now`.
const filler = (count: number) =>
  Array.from({ length: count }, (_, i) => note(`f${i}`, new Date(now.getTime() - (i + 1) * 3_600_000).toISOString(), "Standup"));

beforeEach(() => resetPersonGranolaCache());

describe("granolaMeetingsForPerson", () => {
  it("matches the exact full name in title, attendees or summary, without transcripts", async () => {
    const c = client();
    const out = await granolaMeetingsForPerson("Sample  Contact", { now, client: c });
    expect(out.map((m) => m.id)).toEqual(["n1", "n2"]);
    expect(JSON.stringify(out)).not.toContain("transcript secret");
    expect(c.getNote).toHaveBeenCalledWith("n1");
  });

  it("lists and reads notes once across people", async () => {
    const c = client();
    await granolaMeetingsForPerson("Sample Contact", { now, client: c });
    await granolaMeetingsForPerson("Other Person", { now, client: c });
    expect(c.listNotes).toHaveBeenCalledTimes(1);
    expect(c.getNote).toHaveBeenCalledTimes(4);
  });

  it("matches titles across the whole year but attendees only within the detail window", async () => {
    const list = [
      ...filler(CONTEXT_LIMITS.maxGranolaDetailNotes),
      note("title-old", "2026-03-01T00:00:00Z", "Lunch with Sample Contact", { summary_text: "Real summary" }),
      note("attendee-old", "2026-02-01T00:00:00Z", "Weekly", { attendees: [{ name: "Sample Contact", email: "s@example.com" }] }),
    ];
    const c = client(list);
    const out = await granolaMeetingsForPerson("Sample Contact", { now, client: c });
    expect(out.map((m) => m.id)).toEqual(["title-old"]);
    expect(out[0].text).toContain("Real summary");
    expect(c.getNote).toHaveBeenCalledTimes(CONTEXT_LIMITS.maxGranolaDetailNotes + 1);
    expect(c.getNote).not.toHaveBeenCalledWith("attendee-old");
  });

  it("caps detail reads at the window plus the returned title matches", async () => {
    const titleMatches = Array.from({ length: 10 }, (_, i) =>
      note(`t${i}`, new Date(Date.parse("2026-03-01T00:00:00Z") - i * 86_400_000).toISOString(), "Sample Contact catch-up"));
    const c = client([...filler(100), ...titleMatches]);
    const out = await granolaMeetingsForPerson("Sample Contact", { now, client: c });
    expect(out.map((m) => m.id)).toEqual(titleMatches.slice(0, CONTEXT_LIMITS.maxGranolaMeetings).map((n) => n.id));
    expect(c.getNote).toHaveBeenCalledTimes(CONTEXT_LIMITS.maxGranolaDetailNotes + CONTEXT_LIMITS.maxGranolaMeetings);
  });

  it("is deterministic for a given note list, cold or warm", async () => {
    const list = [...filler(60), note("t", "2026-03-01T00:00:00Z", "Sample Contact 1:1")];
    const cold = await granolaMeetingsForPerson("Sample Contact", { now, client: client(list) });
    const warm = await granolaMeetingsForPerson("Sample Contact", { now, client: client(list) });
    resetPersonGranolaCache();
    const again = await granolaMeetingsForPerson("Sample Contact", { now, client: client(list) });
    expect(warm).toEqual(cold);
    expect(again).toEqual(cold);
  });

  it("never throws on a slow client", async () => {
    const list = [...filler(50), note("t", "2026-03-01T00:00:00Z", "Sample Contact 1:1")];
    const out = await granolaMeetingsForPerson("Sample Contact", { now, client: client(list, 2) });
    expect(out.map((m) => m.id)).toEqual(["t"]);
  });

  it("returns [] without a key, for single names, and on API errors", async () => {
    expect(await granolaMeetingsForPerson("Sample Contact", { now, client: null })).toEqual([]);
    expect(await granolaMeetingsForPerson("Sample", { now, client: client() })).toEqual([]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { listNotes: vi.fn(async () => { throw new Error("401"); }), getNote: vi.fn() };
    expect(await granolaMeetingsForPerson("Sample Contact", { now, client: broken })).toEqual([]);
    const badDetail = { listNotes: vi.fn(async () => notes), getNote: vi.fn(async () => { throw new Error("500"); }) };
    expect(await granolaMeetingsForPerson("Sample Contact", { now, client: badDetail })).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
