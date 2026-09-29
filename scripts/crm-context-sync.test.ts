import { describe, expect, it, vi } from "vitest";
import {
  boundContextThreads, parseFlags, summaryLine, syncCrmContext, threadDigest,
  type API, type Checkpoint, type Flags,
} from "./crm-context-sync";
import { CONTEXT_LIMITS } from "../src/lib/person-context/types";
import type { SyncedMessage } from "../src/lib/dating-message-sync";
import type { ContextTargets } from "../src/lib/person-context/capture";

const now = new Date("2026-09-29T12:00:00Z");
const flags = (extra: Partial<Flags> = {}): Flags => ({ dryRun: false, limit: null, person: null, force: false, includeEmpty: false, verbose: false, ...extra });
const fresh = (): Checkpoint => ({ version: 1, digests: {} });
const m = (guid: string, sentAt: string, text = "hello", source: SyncedMessage["source"] = "imessage"): SyncedMessage => ({ guid, sentAt, fromMe: false, text, source });
const people: ContextTargets["people"] = [
  { id: "one", name: "Avery Example", phone: "+15551234567", email: null, contextAt: null, fingerprint: null },
  { id: "two", name: "Blake Example", phone: "+15557654321", email: null, contextAt: null, fingerprint: null },
];
const reader = { messages: (t: { id: string }) => t.id === "one" ? [m("a", "2026-09-01T00:00:00Z"), m("b", "2026-09-02T00:00:00Z", "hi", "whatsapp")] : [m("c", "2026-09-03T00:00:00Z")] };
const makeApi = (status = "updated") => {
  const post = vi.fn(async (_body: Parameters<API["post"]>[0]) => ({ status } as Awaited<ReturnType<API["post"]>>));
  return { api: { targets: vi.fn(async () => ({ people, blockedHandles: [] })), post }, post };
};
const run = (api: API, extra: Partial<Parameters<typeof syncCrmContext>[0]> = {}) => syncCrmContext({
  api, contacts: async () => [], open: async () => reader, checkpoint: fresh(), save: async () => {},
  flags: flags(), now, sleep: async () => {}, ...extra,
});

describe("boundContextThreads", () => {
  it("keeps the newest messages within caps and returns chronological threads", () => {
    const msgs = Array.from({ length: CONTEXT_LIMITS.maxMessagesPerPerson + 20 }, (_, i) => m(`g${i}`, new Date(now.getTime() - (i + 1) * 60_000).toISOString(), `t${i}`));
    const [thread] = boundContextThreads([...msgs, m("old", "2025-01-01T00:00:00Z"), m("future", "2026-10-01T00:00:00Z"), m("blank", "2026-09-01T00:00:00Z", "  "), m("g0", now.toISOString(), "dupe")], now);
    expect(thread.messages).toHaveLength(CONTEXT_LIMITS.maxMessagesPerPerson);
    expect(thread.messages.at(-1)!.id).toBe("g0");
    expect(thread.messages[0].id).toBe(`g${CONTEXT_LIMITS.maxMessagesPerPerson - 1}`);
    expect(thread.messages.map((x) => x.id)).not.toContain("old");
    expect(thread.messages.map((x) => x.id)).not.toContain("future");
    expect(thread.messages.map((x) => x.id)).not.toContain("blank");
  });

  it("truncates long messages and stops at the total char budget, keeping newest", () => {
    const long = "x".repeat(CONTEXT_LIMITS.maxCharsPerMessage + 500);
    const msgs = Array.from({ length: 60 }, (_, i) => m(`g${i}`, new Date(now.getTime() - (i + 1) * 60_000).toISOString(), long));
    const [thread] = boundContextThreads(msgs, now);
    expect(thread.messages.every((x) => x.text.length === CONTEXT_LIMITS.maxCharsPerMessage)).toBe(true);
    expect(thread.messages.reduce((n, x) => n + x.text.length, 0)).toBeLessThanOrEqual(CONTEXT_LIMITS.maxThreadChars);
    expect(thread.messages.at(-1)!.id).toBe("g0");
  });

  it("splits sources", () => {
    const threads = boundContextThreads(reader.messages({ id: "one" }), now);
    expect(threads.map((t) => t.source)).toEqual(["imessage", "whatsapp"]);
  });
});

describe("parseFlags", () => {
  it("parses every flag", () => {
    expect(parseFlags(["--dry-run", "--limit", "3", "--person", "Avery  Example", "--force", "--include-empty", "--verbose"]))
      .toEqual({ dryRun: true, limit: 3, person: "Avery Example", force: true, includeEmpty: true, verbose: true });
    expect(parseFlags([]).verbose).toBe(false);
    expect(parseFlags(["--limit=2"]).limit).toBe(2);
    expect(() => parseFlags(["--limit", "x"])).toThrow();
    expect(() => parseFlags(["--person"])).toThrow();
    expect(() => parseFlags(["--bogus"])).toThrow();
  });
});

describe("syncCrmContext", () => {
  it("posts bounded threads and checkpoints; unchanged digests skip the POST", async () => {
    const { api, post } = makeApi();
    const checkpoint = fresh();
    const first = await run(api, { checkpoint });
    expect(first).toMatchObject({ targets: 2, posted: 2, updated: 2, failed: 0 });
    expect(post.mock.calls[0][0]).toMatchObject({ personId: "one", threads: [{ source: "imessage" }, { source: "whatsapp" }] });
    expect(checkpoint.digests.one).toBe(threadDigest(boundContextThreads(reader.messages({ id: "one" }), now)));
    api.targets.mockResolvedValue({ people: people.map((p) => ({ ...p, contextAt: now.toISOString() })), blockedHandles: [] });
    post.mockClear();
    const again = await run(api, { checkpoint });
    expect(again).toMatchObject({ posted: 0, unchanged: 2 });
    expect(post).not.toHaveBeenCalled();
    expect((await run(api, { checkpoint, flags: flags({ force: true }) })).posted).toBe(2);
    expect(post.mock.calls[0][0]).toMatchObject({ force: true });
  });

  it("dry run makes no POST and saves nothing", async () => {
    const { api, post } = makeApi();
    const save = vi.fn();
    const result = await run(api, { flags: flags({ dryRun: true }), save });
    expect(result).toMatchObject({ posted: 0, wouldPost: 2 });
    expect(post).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(summaryLine(result, true)).toContain("2 would post");
  });

  it("honours --limit, --person and --include-empty", async () => {
    const { api, post } = makeApi();
    expect((await run(api, { flags: flags({ limit: 1 }) })).posted).toBe(1);
    post.mockClear();
    await run(api, { flags: flags({ person: "blake example" }) });
    expect(post.mock.calls.map((c) => c[0].personId)).toEqual(["two"]);
    post.mockClear();
    const empty = { messages: () => [] };
    expect(await run(api, { open: async () => empty })).toMatchObject({ posted: 0, skipped: 2 });
    expect((await run(api, { open: async () => empty, flags: flags({ includeEmpty: true }) })).posted).toBe(2);
    expect(post.mock.calls[0][0].threads).toEqual([]);
  });

  it("continues after failures, logs ids only, and retries busy", async () => {
    const { api, post } = makeApi();
    post.mockRejectedValueOnce(new Error("CRM context request failed (500)"));
    const checkpoint = fresh();
    const result = await run(api, { checkpoint });
    expect(result).toMatchObject({ posted: 2, updated: 1, failed: 1, failedIds: ["one"] });
    expect(checkpoint.digests.one).toBeUndefined();
    expect(summaryLine(result, false)).toBe("CRM context sync: 2 targets, 2 posted, 1 updated, 0 unchanged, 0 skipped, 1 failed");
    post.mockReset().mockResolvedValueOnce({ status: "busy" }).mockResolvedValue({ status: "updated" });
    const sleep = vi.fn(async () => {});
    expect((await run(api, { sleep })).updated).toBe(2);
    expect(post).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("--verbose prints one id + status line per posted person, never names", async () => {
    const { api, post } = makeApi();
    post.mockResolvedValueOnce({ status: "busy" }).mockResolvedValueOnce({ status: "busy" }).mockResolvedValueOnce({ status: "busy" })
      .mockRejectedValueOnce(new Error("CRM context request failed (500)"));
    const log = vi.fn();
    await run(api, { log });
    expect(log).not.toHaveBeenCalled();
    post.mockReset().mockResolvedValueOnce({ status: "busy" }).mockResolvedValueOnce({ status: "busy" }).mockResolvedValueOnce({ status: "busy" })
      .mockRejectedValueOnce(new Error("CRM context request failed (500)"));
    await run(api, { log, flags: flags({ verbose: true }) });
    expect(log.mock.calls.map((c) => c[0])).toEqual(["one busy", "two failed"]);
    post.mockReset().mockResolvedValue({ status: "updated" });
    log.mockClear();
    await run(api, { log, flags: flags({ verbose: true }) });
    expect(log.mock.calls.map((c) => c[0])).toEqual(["one updated", "two updated"]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Example");
  });
});
