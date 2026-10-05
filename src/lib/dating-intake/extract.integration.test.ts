import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "@/lib/prisma";
import { callClaudeJSON, ClaudeAPIError, type ClaudeCall } from "@/lib/claude";
import { acceptManifest, acceptRecord } from "./store";
import { hash, type Envelope } from "./contracts";
import { processSource } from "./extract";
vi.mock("@/lib/claude", async (original) => ({
  ...(await original<typeof import("@/lib/claude")>()),
  callClaudeJSON: vi.fn(),
}));
const enabled = process.env.RUN_DATING_INTAKE_INTEGRATION === "1";
if (enabled) {
  const u = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55442" ||
    u.pathname !== "/dating_intake"
  )
    throw new Error("Scratch database required");
}
const timeout = () =>
  Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "TimeoutError",
  });
describe.skipIf(!enabled)("extraction failures and recovery", () => {
  let userId: string, stateId: string;
  // Synthetic journal: each segment names a different invented person.
  const names = ["Alex Rivera", "Sam Lee", "Jordan Park", "Taylor Brooks"];
  const segment = (i: number) =>
    `Second date with ${names[i]} tonight, we held hands on the walk home.`;
  const revision = hash(names.map((_, i) => segment(i)).join(""));
  const env = (
    i: number,
    extra: Partial<Envelope> = {},
  ): Envelope & Record<string, unknown> => ({
    version: 1,
    externalId: "journal",
    revision,
    documentVersion: 1,
    segmentIndex: i,
    segmentCount: names.length,
    text: segment(i),
    title: "Journal",
    occurredAt: null,
    url: null,
    identities: [],
    evidenceFamily: null,
    ...extra,
  });
  const mention = (e: Envelope, eventDate: string | null = null) => {
    const name = names.find((n) => e.text.includes(n))!;
    return { name, summary: `Date with ${name}`, quote: e.text, eventDate };
  };
  // Simulated clock: each extraction "takes" `latency` ms of model time and
  // aborts like fetch does when that exceeds the deadline it was given.
  let offset = 0;
  const realNow = Date.now.bind(Date);
  // Stands in for the Messages API at the transport, so the deadline under test
  // is the one processSource really hands to callClaudeJSON.
  const slowModel = (latency: (text: string) => number) =>
    vi.mocked(callClaudeJSON).mockImplementation((async (call: ClaudeCall) => {
      const { text } = JSON.parse(call.user!) as { text: string };
      const ms = latency(text);
      if (!call.timeoutMs || ms > call.timeoutMs) {
        offset += call.timeoutMs ?? 0;
        throw timeout();
      }
      offset += ms;
      return { mentions: [mention({ text } as Envelope)] };
    }) as typeof callClaudeJSON);
  const state = () =>
    prisma.datingSourceState.findUniqueOrThrow({ where: { id: stateId } });
  const records = () =>
    prisma.datingSourceRecord.findMany({
      where: { userId },
      orderBy: { segmentIndex: "asc" },
    });
  beforeEach(async () => {
    offset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.invalid` },
    });
    stateId = (
      await prisma.datingSourceState.create({
        data: { userId, source: "ecpad", enabled: true },
      })
    ).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  afterAll(() => prisma.$disconnect());

  it("analyzes every segment of a long journal in one run without a false failure", async () => {
    for (let i = 0; i < names.length; i++)
      await acceptRecord(userId, stateId, env(i));
    // ~12 s per dense 12k-character segment, measured against the production model.
    slowModel(() => 12000);
    const run = await processSource(userId, stateId);
    expect(run.calls).toBe(4);
    expect((await records()).map((r) => r.status)).toEqual([
      "processed",
      "processed",
      "processed",
      "processed",
    ]);
    expect((await state()).error).toBeNull();
    expect(
      await prisma.datingSuggestion.count({ where: { userId } }),
    ).toBe(4);
  });

  it("gives a dense segment longer than 20 s enough time on its own", async () => {
    await acceptRecord(
      userId,
      stateId,
      env(0, { segmentCount: 1, revision: hash(segment(0)) }),
    );
    slowModel(() => 30000);
    await processSource(userId, stateId);
    expect((await records())[0].status).toBe("processed");
    expect((await state()).error).toBeNull();
  });

  it("puts a record the run budget cut short back in line, uncounted and without an error", async () => {
    for (let i = 0; i < names.length; i++)
      await acceptRecord(userId, stateId, env(i));
    // The first segment takes 25 s, so the second starts with ~25 s left and needs 40.
    slowModel((text) => (text.includes(names[1]) ? 40000 : 25000));
    const first = await processSource(userId, stateId, { maxMs: 50000 });
    expect(first.calls).toBe(2);
    const after = await records();
    expect(after.map((r) => [r.status, r.attempts])).toEqual([
      ["extracted", 1],
      ["pending", 0],
      ["pending", 0],
      ["pending", 0],
    ]);
    expect((await state()).error).toBeNull();
    slowModel(() => 25000);
    for (let run = 0; run < 3; run++) await processSource(userId, stateId);
    expect((await records()).every((r) => r.status === "processed")).toBe(
      true,
    );
  });

  it("clears the failure message once retries succeed even while a backlog remains", async () => {
    for (let i = 0; i < names.length; i++)
      await acceptRecord(
        userId,
        stateId,
        env(i, {
          externalId: `t${i}`,
          segmentIndex: 0,
          segmentCount: 1,
          revision: hash(segment(i)),
        }),
      );
    await acceptManifest(userId, stateId, {
      version: 1,
      generation: 1,
      complete: true,
      documents: names.map((_, i) => ({
        externalId: `t${i}`,
        revision: hash(segment(i)),
        documentVersion: 1,
        segmentCount: 1,
      })),
      unavailableIds: [],
    });
    await processSource(userId, stateId, {
      maxCalls: 1,
      extract: async () => {
        throw new ClaudeAPIError(529, "overloaded");
      },
    });
    expect((await state()).error).toBe(
      "Some evidence could not be analyzed. It will retry automatically.",
    );
    // The failed record comes due again; one more is analyzed, two still wait.
    await prisma.datingSourceRecord.updateMany({
      where: { userId, status: "retry" },
      data: { retryAt: new Date(0) },
    });
    await processSource(userId, stateId, {
      maxCalls: 2,
      extract: async (e) => ({ mentions: [mention(e)] }),
    });
    const s = await state();
    expect(s.backlog).toBe(2);
    expect(s.status).toBe("backlog");
    expect(s.error).toBeNull();
  });

  it("names a rejected API key, stops burning the backlog, and recovers on its own once fixed", async () => {
    for (let i = 0; i < names.length; i++)
      await acceptRecord(userId, stateId, env(i));
    const extract = vi.fn(async () => {
      throw new ClaudeAPIError(401, "invalid x-api-key");
    });
    await processSource(userId, stateId, { extract });
    expect(extract).toHaveBeenCalledOnce();
    const broken = await state();
    expect(broken.status).toBe("needs_attention");
    expect(broken.error).toMatch(/HTTP 401/);
    expect(broken.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(broken.error).not.toMatch(/invalid x-api-key/);
    await prisma.datingSourceRecord.updateMany({
      where: { userId, status: "retry" },
      data: { retryAt: new Date(0) },
    });
    await processSource(userId, stateId, {
      extract: async (e) => ({ mentions: [mention(e)] }),
    });
    expect((await records()).every((r) => r.status === "processed")).toBe(
      true,
    );
    expect((await state()).error).toBeNull();
  });

  it("publishes a document whose segment repeats a quote with two dates", async () => {
    await acceptRecord(
      userId,
      stateId,
      env(0, {
        segmentCount: 1,
        text: `${segment(0)} Logged 2026-09-01 and 2026-09-02.`,
        revision: hash(`${segment(0)} Logged 2026-09-01 and 2026-09-02.`),
      }),
    );
    await processSource(userId, stateId, {
      extract: async (e) => ({
        mentions: [mention(e, "2026-09-01"), mention(e, "2026-09-02")],
      }),
    });
    expect((await records())[0].status).toBe("processed");
    expect(
      await prisma.datingSuggestion.count({ where: { userId } }),
    ).toBe(1);
  });
});
