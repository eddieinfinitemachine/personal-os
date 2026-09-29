import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const model = vi.hoisted(() => ({ call: vi.fn(), web: vi.fn() }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: model.call, callClaudeWithServerTools: model.web }));
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/capture/people/context/route";

const enabled = process.env.RUN_PERSON_CONTEXT_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Person context integration tests require a local scratch PostgreSQL database");
  }
}

describe.skipIf(!enabled)("person context capture with real PostgreSQL", () => {
  let userId: string;
  let personId: string;
  const token = "person-context-token";
  const now = new Date();
  const threads = [{ source: "imessage", messages: [{ id: "m1", sentAt: new Date(now.getTime() - 86_400_000).toISOString(), fromMe: false, text: "Coffee on Friday?" }] }];
  const post = (body: object, bearer = token) => POST(new Request("http://localhost/api/capture/people/context", {
    method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify(body),
  }));
  beforeEach(async () => {
    userId = `person-context-${randomUUID()}`;
    const email = `${userId}@example.invalid`;
    vi.stubEnv("CAPTURE_TOKEN", token);
    vi.stubEnv("CAPTURE_TOKENS", "{}");
    vi.stubEnv("FOUNDER_EMAIL", email);
    vi.stubEnv("GRANOLA_API_KEY", "");
    await prisma.user.create({ data: { id: userId, email } });
    personId = (await prisma.person.create({ data: {
      userId, firstName: "Regression", lastName: "Person", notes: "Manual note", howWeMet: "Manual how", role: "Manual role", phone: "+15551230000",
    } })).id;
    model.call.mockReset().mockResolvedValue({ summary: "Coffee is planned.", relationship: { text: "Friend", basis: "inferred" }, topics: ["coffee"], facts: [], openLoops: [] });
    model.web.mockReset().mockResolvedValue({ content: [{ type: "text", text: '{"confident": false}' }], stopReason: "end_turn" });
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    vi.unstubAllEnvs(); vi.restoreAllMocks();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("requires the capture token", async () => {
    expect((await post({ personId, threads }, "wrong")).status).toBe(401);
    expect(model.call).not.toHaveBeenCalled();
  });

  it("writes context without touching manual fields, then short-circuits", async () => {
    const res = await post({ personId, threads });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "updated" });
    const saved = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
    expect(saved).toMatchObject({ notes: "Manual note", howWeMet: "Manual how", role: "Manual role" });
    expect(saved.context).toMatchObject({ summary: "Coffee is planned.", inputs: { imessage: { messages: 1 }, webSearched: true } });
    expect((saved.context as { generation?: unknown }).generation).toBeUndefined();
    expect(await (await post({ personId, threads })).json()).toMatchObject({ status: "unchanged" });
    expect(model.call).toHaveBeenCalledTimes(1);
    const targets = await (await GET(new Request("http://localhost/api/capture/people/context", { headers: { authorization: `Bearer ${token}` } }))).json();
    expect(targets.people).toEqual([expect.objectContaining({ id: personId, contextAt: saved.contextAt!.toISOString() })]);
  });

  it("skips another account's person and restores context on model failure", async () => {
    const foreign = await prisma.user.create({ data: { email: `foreign-${randomUUID()}@example.invalid` } });
    try {
      const other = await prisma.person.create({ data: { userId: foreign.id, firstName: "Foreign", notes: "n" } });
      expect(await (await post({ personId: other.id, threads })).json()).toEqual({ status: "skipped" });
    } finally { await prisma.user.delete({ where: { id: foreign.id } }); }
    model.call.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ personId, threads })).status).toBe(502);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: personId } })).context).toBeNull();
  });

  it("rejects oversized payloads", async () => {
    const big = [{ source: "imessage", messages: [{ id: "m", sentAt: now.toISOString(), fromMe: true, text: "x".repeat(3000) }] }];
    expect((await post({ personId, threads: big })).status).toBe(400);
  });
});
