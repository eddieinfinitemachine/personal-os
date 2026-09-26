import { beforeEach, describe, expect, it, vi } from "vitest";

const filer = vi.hoisted(() => ({
  done: new Set<string>(),
  people: [{ id: "ana1", name: "Ana", remember: [], greenFlags: [], redFlags: [] }],
  fileGranolaMeeting: vi.fn(),
  granolaMeetingsDone: vi.fn(),
  loadKnownPeople: vi.fn(),
}));

vi.mock("@/lib/dating-filer", () => ({
  NOTE_BUDGET: 40_000,
  fileGranolaMeeting: filer.fileGranolaMeeting,
  granolaMeetingsDone: filer.granolaMeetingsDone,
  loadKnownPeople: filer.loadKnownPeople,
}));

import { syncGranola } from "@/lib/dating-granola";
import { GranolaError, type GranolaClient, type GranolaNote, type GranolaNoteSummary } from "@/lib/granola";

function summary(id: string, title: string, day: number, email = "eddie@example.com"): GranolaNoteSummary {
  return {
    id,
    object: "note",
    title,
    owner: { name: "Eddie", email },
    created_at: `2026-09-${String(day).padStart(2, "0")}T15:00:00Z`,
    updated_at: `2026-09-${String(day).padStart(2, "0")}T16:00:00Z`,
  };
}

function detail(s: GranolaNoteSummary, summaryText = "", notes: string | null = null): GranolaNote {
  return {
    ...s,
    web_url: `https://notes.granola.ai/d/${s.id}`,
    calendar_event: null,
    attendees: [],
    summary_text: summaryText,
    summary_markdown: summaryText,
    private_notes_text: notes,
    private_notes_markdown: notes,
    transcript: null,
  };
}

function fakeClient(notes: GranolaNoteSummary[], summaries: Record<string, string> = {}) {
  const getNote = vi.fn(async (id: string, opts?: { transcript?: boolean }) => {
    const s = notes.find((n) => n.id === id)!;
    const d = detail(s, summaries[id] ?? "");
    return opts?.transcript ? { ...d, transcript: [{ speaker: { source: "speaker" }, text: `transcript ${id}` }] } : d;
  });
  const listNotes = vi.fn(async () => [...notes].reverse()); // API order doesn't matter
  return { client: { listNotes, getNote } satisfies GranolaClient, listNotes, getNote };
}

beforeEach(() => {
  filer.done = new Set();
  filer.granolaMeetingsDone.mockReset().mockImplementation(async (_u: string, ids: string[]) => {
    return new Set(ids.filter((id) => filer.done.has(id)));
  });
  filer.loadKnownPeople.mockReset().mockResolvedValue(filer.people);
  filer.fileGranolaMeeting.mockReset().mockImplementation(async (_u: string, m: { meetingId: string }) => {
    filer.done.add(m.meetingId);
    return {
      status: "done",
      filed: [{ meetingId: m.meetingId, personId: "ana1", name: "Ana", eventIds: ["e1"] }],
      suggestions: [],
      skipped: 0,
    };
  });
});

describe("syncGranola", () => {
  const since = new Date("2026-09-01T00:00:00Z");

  it("files candidates oldest-first and screens the rest on their summary", async () => {
    const notes = [
      summary("not_therapy", "Therapy", 3),
      summary("not_gtm", "Weekly GTM", 4),
      summary("not_ana", "Coffee", 5),
      summary("not_block", "Block", 6),
    ];
    const { client, getNote } = fakeClient(notes, { not_ana: "Talked about Ana's new job", not_gtm: "Pipeline review" });
    const res = await syncGranola("u1", { since, client, ownerEmail: null });

    expect(filer.fileGranolaMeeting.mock.calls.map((c) => c[1].meetingId)).toEqual(["not_therapy", "not_ana", "not_block"]);
    const first = filer.fileGranolaMeeting.mock.calls[0][1];
    expect(first).toMatchObject({ title: "Therapy", url: "https://notes.granola.ai/d/not_therapy" });
    expect(first.occurredAt.toISOString()).toBe("2026-09-03T15:00:00.000Z");
    expect(first.text).toContain("transcript not_therapy");
    expect(filer.fileGranolaMeeting.mock.calls[0][2]).toEqual({ markEmpty: true });

    // Title hits go straight to the transcript; others are screened first.
    expect(getNote.mock.calls).toEqual([
      ["not_therapy", { transcript: true }],
      ["not_gtm"],
      ["not_ana"],
      ["not_ana", { transcript: true }],
      ["not_block", { transcript: true }],
    ]);
    expect(res).toMatchObject({
      processed: 4,
      filed: 3,
      suggestions: 0,
      skipped: 0,
      remaining: 0,
      meetings: 3,
      errors: [],
      nextSince: "2026-09-06T15:00:00Z",
    });
  });

  it("skips already-handled meetings before any detail fetch or Claude call", async () => {
    const notes = [summary("not_a", "Therapy", 3), summary("not_b", "Therapy", 4)];
    filer.done = new Set(["not_a", "not_b"]);
    const { client, getNote } = fakeClient(notes);
    const res = await syncGranola("u1", { since, client, ownerEmail: null });
    expect(getNote).not.toHaveBeenCalled();
    expect(filer.fileGranolaMeeting).not.toHaveBeenCalled();
    expect(res).toMatchObject({ processed: 2, skipped: 2, remaining: 0, filed: 0, meetings: 0 });
  });

  it("stops at the limit and resumes from nextSince", async () => {
    const notes = [1, 2, 3, 4, 5].map((d) => summary(`not_${d}`, "Therapy", d + 1));
    const { client, listNotes } = fakeClient(notes);
    const r1 = await syncGranola("u1", { since, client, limit: 2, ownerEmail: null });
    expect(r1).toMatchObject({ processed: 2, meetings: 2, remaining: 3, nextSince: "2026-09-03T15:00:00Z" });

    // The API's created_after may be inclusive; the note a batch ended on is not redone.
    const r2 = await syncGranola("u1", { since: new Date(r1.nextSince), client, limit: 2, ownerEmail: null });
    expect(r2).toMatchObject({ processed: 2, meetings: 2, remaining: 1, skipped: 0 });
    const r3 = await syncGranola("u1", { since: new Date(r2.nextSince), client, limit: 2, ownerEmail: null });
    expect(r3).toMatchObject({ processed: 1, remaining: 0 });
    expect(filer.fileGranolaMeeting.mock.calls.map((c) => c[1].meetingId)).toEqual([
      "not_1",
      "not_2",
      "not_3",
      "not_4",
      "not_5",
    ]);
    expect(listNotes).toHaveBeenLastCalledWith({ createdAfter: new Date(r2.nextSince) });
  });

  it("skips notes someone else owns when an owner email is set", async () => {
    const notes = [summary("not_mine", "Therapy", 3), summary("not_shared", "Therapy", 4, "boss@example.com")];
    const { client, getNote } = fakeClient(notes);
    const res = await syncGranola("u1", { since, client, ownerEmail: "Eddie@Example.com" });
    expect(getNote.mock.calls.map((c) => c[0])).toEqual(["not_mine"]);
    expect(res).toMatchObject({ processed: 2, skipped: 1, meetings: 1 });
  });

  it("reports a failed note and carries on, but stops on auth / rate-limit errors", async () => {
    const notes = [summary("not_a", "Therapy", 3), summary("not_b", "Therapy", 4)];
    const { client, getNote } = fakeClient(notes);
    filer.fileGranolaMeeting.mockResolvedValueOnce({ status: "error", error: "Claude could not file this one" });
    const res = await syncGranola("u1", { since, client, ownerEmail: null });
    expect(res.errors).toEqual([{ meetingId: "not_a", title: "Therapy", error: "Claude could not file this one" }]);
    expect(res.filed).toBe(1);

    getNote.mockRejectedValueOnce(new GranolaError("Granola rejected GRANOLA_API_KEY (401)", 401));
    await expect(syncGranola("u1", { since, client, ownerEmail: null })).rejects.toThrow("401");
  });

  it("throws when GRANOLA_API_KEY is not set and no client is given", async () => {
    vi.stubEnv("GRANOLA_API_KEY", "");
    await expect(syncGranola("u1", { since })).rejects.toThrow("GRANOLA_API_KEY not set");
    vi.unstubAllEnvs();
  });
});
