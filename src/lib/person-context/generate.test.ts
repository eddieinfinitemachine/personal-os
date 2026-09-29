import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claude: vi.fn(),
  web: vi.fn(),
  granola: vi.fn(),
  person: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  interaction: { findMany: vi.fn() },
}));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude, callClaudeWithServerTools: vi.fn() }));
vi.mock("./web", () => ({ PERSON_CONTEXT_MODEL: "claude-sonnet-5-5", searchPublicContext: mocks.web }));
vi.mock("./granola", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./granola")>()),
  granolaMeetingsForPerson: mocks.granola,
}));
vi.mock("@/lib/prisma", () => {
  const tx = { $queryRaw: vi.fn(), person: mocks.person };
  return {
    prisma: {
      person: mocks.person,
      interaction: mocks.interaction,
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import {
  buildContextPrompt,
  contextFingerprint,
  refreshPersonContext,
  renderThreads,
  validateContextReply,
  type ContextPerson,
} from "./generate";
import { GranolaNotReadyError } from "./granola";
import { CONTEXT_LIMITS, PERSON_CONTEXT_VERSION, type ContextThread } from "./types";

const now = new Date("2026-09-29T12:00:00Z");
const base: ContextPerson & { userId: string; archived: boolean; updatedAt: Date; context: unknown; contextAt: Date | null; phone: null; email: null } = {
  id: "p1", userId: "u1", firstName: "Sample", lastName: "Contact", strength: "close", circles: [], tags: [],
  company: null, role: null, city: null, country: null, howWeMet: "Met at a conference", interests: [],
  birthday: null, lastInteractionAt: null, notes: "Private manual note", archived: false,
  updatedAt: new Date("2026-09-01T00:00:00Z"), context: null, contextAt: null, phone: null, email: null,
};
const msg = (id: string, sentAt: string, text: string, fromMe = false) => ({ id, sentAt, fromMe, text });
const threads: ContextThread[] = [
  { source: "imessage", messages: [msg("a", "2026-09-01T10:00:00Z", "Are we still on for Friday?"), msg("b", "2026-09-02T10:00:00Z", "Yes, see you there", true)] },
];
const reply = {
  summary: "A close friend Eddie met at a conference.",
  relationship: { text: "Conference friend", basis: "stated" },
  topics: ["Friday plans"],
  facts: [{ text: "Planning to meet Friday", confidence: "HIGH", evidence: { source: "imessage", at: "2026-09-01T10:00:00Z", quote: "Are we still on for Friday?" } }],
  openLoops: [],
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.person.findFirst.mockReset().mockResolvedValue({ ...base });
  mocks.person.update.mockReset().mockImplementation(async () => ({ updatedAt: new Date("2026-09-29T12:00:01Z") }));
  mocks.person.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mocks.interaction.findMany.mockReset().mockResolvedValue([]);
  mocks.granola.mockReset().mockResolvedValue([]);
  mocks.web.mockReset().mockResolvedValue(undefined);
  mocks.claude.mockReset().mockResolvedValue(reply);
});
afterEach(() => vi.restoreAllMocks());

describe("renderThreads", () => {
  it("keeps the newest messages within budget and renders them oldest first per source", () => {
    const many: ContextThread[] = [
      { source: "imessage", messages: Array.from({ length: 50 }, (_, i) => msg(`i${i}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), `imessage ${i}`)) },
      { source: "whatsapp", messages: [msg("w1", "2026-03-01T00:00:00Z", "whatsapp latest", true)] },
    ];
    const { text, inputs } = renderThreads(many, 300);
    expect(text).toContain("[2026-03-01] Me: whatsapp latest");
    expect(text).toContain("Them: imessage 49");
    expect(text).not.toContain("imessage 0\n");
    expect(text.indexOf("imessage 45")).toBeLessThan(text.indexOf("imessage 49"));
    expect(text.indexOf("iMessage thread")).toBeLessThan(text.indexOf("WhatsApp thread"));
    expect(inputs.whatsapp).toEqual({ messages: 1, from: "2026-03-01", to: "2026-03-01" });
    expect(inputs.imessage!.to).toBe("2026-02-19");
    expect(inputs.imessage!.messages).toBeLessThan(50);
  });

  it("caps the whole prompt thread section at maxThreadChars", () => {
    const long = "x".repeat(CONTEXT_LIMITS.maxCharsPerMessage);
    const big: ContextThread[] = [{ source: "imessage", messages: Array.from({ length: 100 }, (_, i) => msg(`m${i}`, new Date(Date.UTC(2026, 0, 1, i)).toISOString(), long)) }];
    expect(renderThreads(big).text.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxThreadChars + 100);
  });

  it("puts CRM, interactions, meetings and threads in the prompt, with meetings capped", () => {
    const meetings = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, date: "2026-08-01T00:00:00Z", title: `Meeting ${i}`, text: "y".repeat(5000) }));
    const { user } = buildContextPrompt(
      { ...base, company: "Example Co" },
      [{ id: "i1", occurredAt: new Date("2026-08-02T00:00:00Z"), kind: "dinner", title: "Dinner", location: null, notes: null }],
      meetings,
      threads,
    );
    expect(user.indexOf("CRM profile")).toBeLessThan(user.indexOf("Already in the CRM"));
    expect(user).toContain("Company: Example Co");
    expect(user).toContain("How we met: Met at a conference");
    expect(user).toContain("- 2026-08-02 dinner: Dinner");
    expect(user.match(/^## /gm)).toHaveLength(CONTEXT_LIMITS.maxGranolaMeetings);
    expect(user).not.toContain("y".repeat(CONTEXT_LIMITS.maxGranolaCharsPerMeeting + 1));
    expect(user.indexOf("[2026-09-01] Them: Are we still on")).toBeLessThan(user.indexOf("[2026-09-02] Me: Yes"));
  });
});

describe("contextFingerprint", () => {
  it("is stable and changes with any input", () => {
    const fp = contextFingerprint(base, [], [], threads);
    expect(contextFingerprint({ ...base }, [], [], structuredClone(threads))).toBe(fp);
    expect(contextFingerprint({ ...base, notes: "changed" }, [], [], threads)).not.toBe(fp);
    expect(contextFingerprint(base, [], [{ id: "g1", date: "", title: "", text: "" }], threads)).not.toBe(fp);
    expect(contextFingerprint(base, [{ id: "i1", occurredAt: now, kind: "call", title: "t", location: null, notes: null }], [], threads)).not.toBe(fp);
    const edited = structuredClone(threads);
    edited[0].messages[0].text = "different";
    expect(contextFingerprint(base, [], [], edited)).not.toBe(fp);
  });
});

describe("validateContextReply", () => {
  it("drops bad items, clamps and coerces", () => {
    const out = validateContextReply({
      summary: "  ok  ",
      relationship: { text: "Friend", basis: "certain" },
      topics: ["a", "A", 3, "b", "c", "d", "e", "f", "g"],
      facts: [
        ...Array.from({ length: 12 }, (_, i) => ({ text: `fact ${i}`, confidence: "maybe", evidence: { source: "web", quote: "q" } })),
      ],
      openLoops: [null, { text: "" }, { text: "Call back", confidence: "Medium", evidence: { source: "whatsapp", quote: "z".repeat(500), at: "nope" } }],
    });
    expect(out.summary).toBe("ok");
    expect(out.relationship).toEqual({ text: "Friend", basis: "inferred" });
    expect(out.topics).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(out.facts).toHaveLength(8);
    expect(out.facts[0]).toEqual({ text: "fact 0", confidence: "low" });
    expect(out.openLoops).toEqual([{ text: "Call back", confidence: "medium", evidence: { source: "whatsapp", quote: "z".repeat(200) } }]);
  });

  it("rejects replies without a summary", () => {
    expect(() => validateContextReply({ facts: [] })).toThrow();
    expect(() => validateContextReply([])).toThrow();
  });
});

describe("refreshPersonContext", () => {
  it("writes only context/contextAt with inputs counts and fingerprint", async () => {
    const result = await refreshPersonContext("u1", "p1", { threads, now });
    expect(result).toEqual({ status: "updated", contextAt: now.toISOString() });
    expect(mocks.claude).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-sonnet-5-5" }));
    const write = mocks.person.updateMany.mock.calls.at(-1)![0];
    expect(Object.keys(write.data).sort()).toEqual(["context", "contextAt"]);
    expect(write.where.updatedAt).toEqual(new Date("2026-09-29T12:00:01Z"));
    expect(write.data.context).toMatchObject({
      version: PERSON_CONTEXT_VERSION,
      model: "claude-sonnet-5-5",
      relationship: { basis: "stated" },
      facts: [{ confidence: "high", evidence: { at: "2026-09-01" } }],
      inputs: { imessage: { messages: 2, from: "2026-09-01", to: "2026-09-02" } },
      sourceFingerprint: contextFingerprint(base, [], [], threads),
    });
    expect(write.data.context.generation).toBeUndefined();
    expect(JSON.stringify(write.data.context.inputs)).not.toContain("Friday");
  });

  it("short-circuits unchanged inputs without calling Claude", async () => {
    mocks.person.findFirst.mockResolvedValue({
      ...base, contextAt: now,
      context: { summary: "s", sourceFingerprint: contextFingerprint(base, [], [], threads) },
    });
    expect(await refreshPersonContext("u1", "p1", { threads, now })).toEqual({ status: "unchanged", contextAt: now.toISOString() });
    expect(mocks.claude).not.toHaveBeenCalled();
    expect(mocks.person.update).not.toHaveBeenCalled();
    await refreshPersonContext("u1", "p1", { threads, now, force: true });
    expect(mocks.claude).toHaveBeenCalledTimes(1);
  });

  it("skips missing, archived and empty people; busy on a live lease or cold Granola", async () => {
    mocks.person.findFirst.mockResolvedValueOnce(null);
    expect((await refreshPersonContext("u1", "p1", { threads, now })).status).toBe("skipped");
    mocks.person.findFirst.mockResolvedValueOnce({ ...base, archived: true });
    expect((await refreshPersonContext("u1", "p1", { threads, now })).status).toBe("skipped");
    mocks.person.findFirst.mockResolvedValueOnce({ ...base, notes: null, howWeMet: null });
    expect((await refreshPersonContext("u1", "p1", { threads: [], now })).status).toBe("skipped");
    const leased = { ...base, context: { generation: { owner: "x", startedAt: new Date(now.getTime() - 10_000).toISOString() } } };
    mocks.person.findFirst.mockResolvedValue(leased);
    expect((await refreshPersonContext("u1", "p1", { threads, now })).status).toBe("busy");
    mocks.person.findFirst.mockResolvedValue({ ...base });
    mocks.granola.mockRejectedValueOnce(new GranolaNotReadyError());
    expect((await refreshPersonContext("u1", "p1", { threads, now })).status).toBe("busy");
    expect(mocks.claude).not.toHaveBeenCalled();
  });

  it("skips web search without company or role", async () => {
    await refreshPersonContext("u1", "p1", { threads, now });
    expect(mocks.web).not.toHaveBeenCalled();
    mocks.person.findFirst.mockResolvedValue({ ...base, role: "Engineer" });
    mocks.web.mockResolvedValue({ text: "Public", sources: [{ title: "t", url: "https://example.com/" }] });
    await refreshPersonContext("u1", "p1", { threads, now });
    expect(mocks.web).toHaveBeenCalledTimes(1);
    expect(mocks.person.updateMany.mock.calls.at(-1)![0].data.context).toMatchObject({
      publicContext: { text: "Public" }, inputs: { webSearched: true },
    });
  });

  it("keeps the refresh when web search fails", async () => {
    mocks.person.findFirst.mockResolvedValue({ ...base, company: "Example Co" });
    mocks.web.mockRejectedValue(new Error("boom"));
    expect((await refreshPersonContext("u1", "p1", { threads, now })).status).toBe("updated");
    const context = mocks.person.updateMany.mock.calls.at(-1)![0].data.context;
    expect(context.publicContext).toBeUndefined();
    expect(context.inputs.webSearched).toBeUndefined();
  });

  it("releases the lease and throws when Claude fails", async () => {
    mocks.claude.mockRejectedValue(new Error("Claude error 500: prompt echo"));
    await expect(refreshPersonContext("u1", "p1", { threads, now })).rejects.toThrow("Could not generate context");
    const release = mocks.person.updateMany.mock.calls.at(-1)![0];
    expect(release.where.context.path).toEqual(["generation", "owner"]);
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("prompt echo"));
  });

  it("reports busy when the person changed during generation", async () => {
    mocks.person.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await refreshPersonContext("u1", "p1", { threads, now })).status).toBe("busy");
  });
});
