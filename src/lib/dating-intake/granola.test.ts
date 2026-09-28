import { describe, expect, it, vi } from "vitest";
import { granolaCursor, granolaEnvelopes, runGranolaQueue, type GranolaCursor } from "./granola";
import type { GranolaNote, GranolaNoteSummary } from "../granola";
import { hash } from "./contracts";
const start = Date.parse("2026-09-28T00:00:00Z");
const summary = (id: string): GranolaNoteSummary => ({ id, title: "Session", owner: { name: "Owner", email: "owner@example.invalid" }, created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z" });
const note = (id: string): GranolaNote => ({ ...summary(id), web_url: "https://example.invalid/note", calendar_event: null, attendees: [], summary_text: "Dating conversation", summary_markdown: null, private_notes_text: null, private_notes_markdown: null, transcript: [{ speaker: { source: "microphone" }, text: "Robin and I planned another date." }] });

describe("durable Granola intake", () => {
  it("persists a page before content, processes six of thirty and resumes the backlog", async () => {
    let saved = granolaCursor(null, start);
    const save = vi.fn(async (cursor: GranolaCursor) => { saved = cursor; });
    const listNotesPage = vi.fn().mockResolvedValue({ notes: Array.from({ length: 30 }, (_, i) => summary(`note-${i}`)), hasMore: false, cursor: null });
    const getNote = vi.fn(async (id: string) => { expect(saved.queue.some((task) => task.id === id)).toBe(true); return note(id); });
    const upload = vi.fn().mockResolvedValue(true);
    const client = { listNotesPage, getNote, listNotes: vi.fn() };
    const first = await runGranolaQueue(saved, { client, save, upload, now: () => start });
    expect(first.attempted).toBe(6); expect(first.remaining).toBe(24); expect(first.complete).toBe(false);
    expect(listNotesPage).toHaveBeenCalledOnce();
    for (let i = 0; i < 4; i++) await runGranolaQueue(saved, { client, save, upload, now: () => start });
    expect(upload).toHaveBeenCalledTimes(30); expect(saved.adapterBacklog).toBe(0);
    expect(listNotesPage).toHaveBeenCalledOnce();
  });

  it("retries old failed notes beyond the lookback window without losing later pages", async () => {
    let now = start;
    let saved = granolaCursor(null, start);
    const listNotesPage = vi.fn().mockResolvedValueOnce({ notes: [summary("old")], hasMore: true, cursor: "page2" }).mockRejectedValueOnce(new Error("page failed")).mockResolvedValue({ notes: [summary("new")], hasMore: false, cursor: null });
    const getNote = vi.fn().mockRejectedValueOnce(new Error("transcript failed")).mockImplementation(async (id: string) => note(id));
    const save = async (cursor: GranolaCursor) => { saved = cursor; };
    const upload = vi.fn().mockResolvedValue(true);
    const client = { listNotesPage, getNote, listNotes: vi.fn() };
    await runGranolaQueue(saved, { client, save, upload, now: () => now });
    expect(saved.queue[0].attempts).toBe(1);
    expect(saved.pageCursor).toBe("page2");
    now += 20 * 86_400_000;
    await runGranolaQueue(saved, { client, save, upload, now: () => now });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ id: "old" }));
    expect(saved.pageCursor).toBe("page2"); expect(saved.enumerated).toBe(false);
    await runGranolaQueue(saved, { client, save, upload, now: () => now });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }));
    expect(saved.adapterBacklog).toBe(0);
  });

  it("leaves a partially uploaded note queued and stops when the wall-clock budget is spent", async () => {
    let now = start;
    const saved = granolaCursor(null, start);
    const client = { listNotes: vi.fn(), listNotesPage: vi.fn().mockResolvedValue({ notes: [summary("n1"), summary("n2")], hasMore: false, cursor: null }), getNote: vi.fn(async (id: string) => note(id)) };
    const result = await runGranolaQueue(saved, { client, save: async () => {}, now: () => now, maxMs: 45_000, upload: async () => { now += 45_000; return false; } });
    expect(result.complete).toBe(false); expect(result.remaining).toBe(2);
    expect(client.getNote).toHaveBeenCalledOnce();
  });

  it("retains every character across Unicode-safe segments and canonical meeting identity", () => {
    const input = note("canonical-id"); input.transcript![0].text = "🪴".repeat(20_000);
    const envelopes = granolaEnvelopes(input, 7);
    expect(envelopes.length).toBeGreaterThan(1);
    expect(envelopes.every((entry) => entry.text.length <= 12_000 && entry.documentVersion === 7 && entry.evidenceFamily === "granola:canonical-id")).toBe(true);
    const full = envelopes.map((entry) => entry.text).join("");
    expect(full).toContain(input.transcript![0].text);
    expect(hash(full)).toBe(envelopes[0].revision);
    input.title = "Edited title";
    expect(granolaEnvelopes(input, 8)[0].revision).not.toBe(envelopes[0].revision);
  });
});
