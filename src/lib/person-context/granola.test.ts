import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GranolaClient, GranolaNote } from "@/lib/granola";
import { granolaMeetingsForPerson, GranolaNotReadyError, resetPersonGranolaCache } from "./granola";

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
const client = (): GranolaClient & { listNotes: ReturnType<typeof vi.fn>; getNote: ReturnType<typeof vi.fn> } => ({
  listNotes: vi.fn(async () => notes),
  getNote: vi.fn(async (id: string) => notes.find((n) => n.id === id)!),
});

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

  it("returns [] without a key, for single names, and on API errors", async () => {
    expect(await granolaMeetingsForPerson("Sample Contact", { now, client: null })).toEqual([]);
    expect(await granolaMeetingsForPerson("Sample", { now, client: client() })).toEqual([]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { listNotes: vi.fn(async () => { throw new Error("401"); }), getNote: vi.fn() };
    expect(await granolaMeetingsForPerson("Sample Contact", { now, client: broken })).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("reports not-ready instead of partial results when the budget runs out", async () => {
    await expect(granolaMeetingsForPerson("Sample Contact", { now, client: client(), budgetMs: -1 })).rejects.toBeInstanceOf(GranolaNotReadyError);
  });
});
