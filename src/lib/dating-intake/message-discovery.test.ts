import { describe, expect, it, vi } from "vitest";
import { discoverableThread, discoveryEnvelopes, runMessageDiscovery, type DiscoveryCheckpoint, type DiscoveryMessage, type DiscoveryThread } from "./message-discovery";
const now = Date.parse("2026-09-28T12:00:00Z");
const thread: DiscoveryThread = { id: "one", source: "imessage", handle: "+15551234567", oneToOne: true };
const message: DiscoveryMessage = { position: { date: "42", id: 1 }, guid: "m1", sentAt: "2026-09-27T12:00:00Z", fromMe: false, text: "Would you like to go on another date?" };
const config = { enabled: true, stateId: "source", days: 30, excludedHandles: [] };
const fresh = (): DiscoveryCheckpoint => ({ version: 1, stateId: "source", nextThread: 0, threads: {} });
const ack = async (entry: ReturnType<typeof discoveryEnvelopes>[0]) => ({ accepted: true, externalId: entry.externalId, revision: entry.revision, segmentIndex: entry.segmentIndex, documentVersion: entry.documentVersion });

describe("opt-in message discovery", () => {
  it("does not even enumerate when disabled, and filters groups, services and exact exclusions", async () => {
    const list = vi.fn();
    await runMessageDiscovery({ config: { ...config, enabled: false }, checkpoint: fresh(), list, read: vi.fn(), send: vi.fn(), save: vi.fn(), progress: vi.fn() });
    expect(list).not.toHaveBeenCalled();
    expect(discoverableThread(thread, new Set())).toBe(true);
    expect(discoverableThread({ ...thread, oneToOne: false }, new Set())).toBe(false);
    expect(discoverableThread({ ...thread, handle: "12345" }, new Set())).toBe(false);
    expect(discoverableThread({ ...thread, handle: "noreply@example.com" }, new Set())).toBe(false);
    expect(discoverableThread(thread, new Set([thread.handle]))).toBe(false);
    expect(discoveryEnvelopes(thread, [{ ...message, text: "Your verification code is 1234" }], 1, 1)[0].text).toBe("");
  });

  it("resumes a chunk larger than forty segments, saves only metadata and advances only after exact acknowledgment", async () => {
    let checkpoint = fresh();
    const huge = { ...message, text: "🪴".repeat(250_000) };
    const read = vi.fn(async (_thread, from) => from ? { messages: [], through: null, hasMore: false } : { messages: [huge], through: message.position, hasMore: false });
    const send = vi.fn(ack);
    const progress = vi.fn();
    const options = { config, now: () => now, list: async () => [thread], read, send, save: async (value: DiscoveryCheckpoint) => { checkpoint = value; }, progress };
    const first = await runMessageDiscovery({ ...options, checkpoint });
    expect(first.sent).toBe(40); expect(first.complete).toBe(false);
    expect(JSON.stringify(checkpoint)).not.toContain("🪴");
    expect(Object.values(checkpoint.threads)[0].position).toBeNull();
    const second = await runMessageDiscovery({ ...options, checkpoint });
    expect(second.sent).toBeGreaterThan(0); expect(second.complete).toBe(true);
    expect(send).toHaveBeenCalledTimes(discoveryEnvelopes(thread, [huge], 1, 1).length);
    expect(Object.values(checkpoint.threads)[0].position).toEqual(message.position);
    expect(Object.values(checkpoint.threads)[0].pending).toBeUndefined();
  });

  it("retries rejected and mismatched acknowledgments with the same immutable ID and version", async () => {
    let checkpoint = fresh();
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ accepted: true, revision: "wrong", segmentIndex: 0, documentVersion: 1 }).mockImplementation(ack);
    const progress = vi.fn();
    const options = { config, now: () => now, list: async () => [thread], read: async () => ({ messages: [message], through: message.position, hasMore: false }), send, save: async (value: DiscoveryCheckpoint) => { checkpoint = value; }, progress };
    await runMessageDiscovery({ ...options, checkpoint });
    expect(Object.values(checkpoint.threads)[0].position).toBeNull();
    await runMessageDiscovery({ ...options, checkpoint });
    expect(Object.values(checkpoint.threads)[0].position).toBeNull();
    await runMessageDiscovery({ ...options, checkpoint });
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[2][0]);
    expect(progress.mock.calls[0][0]).toMatchObject({ complete: false, error: true });
  });

  it("reconstructs expired input from saved boundaries and keeps missing originals visibly incomplete", async () => {
    let checkpoint = fresh();
    const send = vi.fn(ack);
    const progress = vi.fn();
    const options = { config, now: () => now, list: async () => [thread], read: async (_thread: DiscoveryThread, from: unknown) => from ? { messages: [], through: null, hasMore: false } : { messages: [message], through: message.position, hasMore: false }, send, save: async (value: DiscoveryCheckpoint) => { checkpoint = value; }, progress };
    await runMessageDiscovery({ ...options, checkpoint });
    const externalId = send.mock.calls[0][0].externalId;
    const recovery = { ...options, checkpoint, config: { ...config, refetchIds: [externalId] } };
    expect((await runMessageDiscovery(recovery)).complete).toBe(true);
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    const missing = await runMessageDiscovery({ ...recovery, checkpoint, read: async () => ({ messages: [], through: null, hasMore: false }) });
    expect(missing.complete).toBe(false);
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ complete: false, error: true, remaining: 1 });
    expect(JSON.stringify(checkpoint)).not.toContain(message.text);
  });

  it("keeps an unfinished scan's original date window when later runs resume", async () => {
    let checkpoint = fresh(); let clock = now;
    const other = { ...thread, id: "two", handle: "+15557654321" };
    const list = vi.fn(async () => [thread, other]);
    const progress = vi.fn();
    const options = { config, now: () => clock, maxSegments: 1, list, read: async () => ({ messages: [message], through: message.position, hasMore: false }), send: ack, save: async (value: DiscoveryCheckpoint) => { checkpoint = value; }, progress };
    expect((await runMessageDiscovery({ ...options, checkpoint })).complete).toBe(false);
    clock += 2 * 86_400_000;
    expect((await runMessageDiscovery({ ...options, checkpoint })).complete).toBe(true);
    expect(list.mock.calls[0]).toEqual(list.mock.calls[1]);
    expect(progress.mock.calls[1][0].coverageEnd).toBe(new Date(now).toISOString());
  });

  it("increments a pending document version when source text changes and stops at the time budget", async () => {
    let checkpoint = fresh(); let clock = now; let changed = false;
    const send = vi.fn(async (entry) => { clock += 45_000; return ack(entry); });
    const options = { config, now: () => clock, list: async () => [thread], read: async () => ({ messages: [{ ...message, text: (changed ? "new" : "old").repeat(8_000) }], through: message.position, hasMore: false }), send, save: async (value: DiscoveryCheckpoint) => { checkpoint = value; }, progress: vi.fn() };
    expect((await runMessageDiscovery({ ...options, checkpoint })).complete).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    changed = true;
    await runMessageDiscovery({ ...options, checkpoint });
    expect(send.mock.calls[1][0].documentVersion).toBe(2);
    expect(send.mock.calls[1][0].externalId).toBe(send.mock.calls[0][0].externalId);
  });
});
