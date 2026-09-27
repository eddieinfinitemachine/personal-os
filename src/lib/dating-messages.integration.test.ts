import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Only auth is stubbed: these checks exercise the actual handlers and Postgres.
vi.mock("@/lib/auth", () => ({
  getCurrentUserId: async (request: Request) => request.headers.get("x-user-id"),
}));

import { GET, POST } from "@/app/api/dating/[id]/messages/route";
import { prisma } from "@/lib/prisma";

const enabled = process.env.RUN_DATING_MESSAGE_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/dating_outstanding") {
    throw new Error("Message integration tests require the local dating_outstanding scratch database");
  }
}

describe.skipIf(!enabled)("dating messages with real Postgres", () => {
  const userId = `message-regression-${randomUUID()}`;
  const otherId = `message-regression-${randomUUID()}`;
  let personId: string;
  const ctx = () => ({ params: Promise.resolve({ id: personId }) });
  const get = (query = "", owner: string | null = userId) => GET(new Request(`http://localhost/api/dating/${personId}/messages?${query}`, {
    headers: owner ? { "x-user-id": owner } : {},
  }), ctx());
  const post = (text: string, owner: string | null = userId) => POST(new Request(`http://localhost/api/dating/${personId}/messages`, {
    method: "POST", headers: owner ? { "x-user-id": owner } : {}, body: JSON.stringify({ text }),
  }), ctx());

  beforeAll(async () => {
    await prisma.user.createMany({ data: [userId, otherId].map((id) => ({ id, email: `${id}@example.invalid` })) });
  });
  beforeEach(async () => {
    personId = (await prisma.datingPerson.create({ data: { userId, name: "Ana Regression" } })).id;
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("reads every message once across timestamp ties, including filtered pages", async () => {
    const sentAt = new Date("2026-09-01T12:00:00Z");
    await prisma.datingMessage.createMany({
      data: Array.from({ length: 451 }, (_, i) => ({
        id: `${personId}-${String(i).padStart(4, "0")}`, userId, personId, sentAt,
        fromMe: false, text: `hello ${i}`, externalId: `${personId}-${i}`,
      })),
    });
    for (const filter of ["", "hello"]) {
      const ids: string[] = [];
      let query = new URLSearchParams({ q: filter });
      let more = true;
      for (let page = 0; page < 4 && more; page++) {
        const response = await get(query.toString());
        expect(response.status).toBe(200);
        const data = await response.json();
        ids.push(...data.messages.map((m: { id: string }) => m.id));
        more = data.more;
        if (more) {
          const oldest = data.messages[0];
          query = new URLSearchParams({ q: filter, before: oldest.sentAt, beforeId: oldest.id });
        }
      }
      expect(ids).toHaveLength(451);
      expect(new Set(ids).size).toBe(451);
      expect(more).toBe(false);
    }
  });

  it("re-pasting undated messages days later adds zero while keeping repeated lines", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
    const first = await post("Ana: hello\nMe: hi\nAna: hello");
    expect(await first.json()).toMatchObject({ parsed: 3, added: 3 });
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    const second = await post("Ana: hello\nMe: hi\nAna: hello");
    expect(await second.json()).toMatchObject({ parsed: 3, added: 0 });
    const rows = await prisma.datingMessage.findMany({ where: { personId }, orderBy: { sentAt: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows[0].sentAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
  });

  it("rejects malformed or incomplete compound cursors", async () => {
    for (const query of ["before=invalid&beforeId=x", "beforeId=x", "before=2026-09-01T00:00:00Z", "before=2026-09-01T00:00:00Z&beforeId="]) {
      expect((await get(query)).status).toBe(400);
    }
  });

  it("requires authentication and person ownership for reading and importing", async () => {
    expect((await get("", null)).status).toBe(401);
    expect((await post("Ana: hi", null)).status).toBe(401);
    expect((await get("", otherId)).status).toBe(404);
    expect((await post("Ana: hi", otherId)).status).toBe(404);
    expect(await prisma.datingMessage.count({ where: { personId } })).toBe(0);
  });
});
