import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: async () => auth.userId || null }));
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

// Opt-in: RUN_ACTIVITIES_INTEGRATION=1 with the isolated scratch database only.
const enabled = process.env.RUN_ACTIVITIES_INTEGRATION === "1";
if (enabled && process.env.DATABASE_URL !== "postgresql://postgres@127.0.0.1:55442/dating_intake")
  throw new Error("Activities integration requires the exact isolated scratch database URL");

const key = (n: number) => `ecpad:${n.toString(16).padStart(64, "0")}`;
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10) + "T00:00:00Z";
const ids: string[] = [];
let owner: { userId: string; people: string[] };
let other: { userId: string; people: string[] };
async function seed() {
  const user = await prisma.user.create({ data: { email: `activities-${crypto.randomUUID()}@example.invalid` } });
  ids.push(user.id);
  const people = await Promise.all(
    ["Alex Rivera", "Sam Example"].map((name) => {
      const [firstName, lastName] = name.split(" ");
      return prisma.person.create({ data: { userId: user.id, firstName, lastName } });
    }),
  );
  return { userId: user.id, people: people.map((p) => p.id) };
}
async function send(as: string, body: unknown) {
  auth.userId = as;
  const res = await POST(new Request("https://example.invalid/api/capture/activities", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const activity = (n: number, personIds: string[], extra: Record<string, unknown> = {}) => ({
  externalKey: key(n),
  personIds,
  occurredAt: day(n),
  kind: "dinner",
  title: `Synthetic dinner ${n}`,
  notes: "“exact synthetic quote”",
  sourceTitle: "Synthetic journal",
  sourceRef: "ecpad://note/Synthetic.md",
  ...extra,
});

describe.skipIf(!enabled)("activities capture on real PostgreSQL", () => {
  beforeEach(async () => {
    owner = await seed();
    other = await seed();
  });
  afterAll(async () => {
    if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("upserts idempotently by externalKey and updates in place", async () => {
    const batch = { activities: [activity(1, [owner.people[0]]), activity(2, owner.people)] };
    expect(await send(owner.userId, batch)).toEqual({ status: 200, body: { upserted: 2, deleted: 0 } });
    const first = await prisma.interaction.findMany({ where: { userId: owner.userId }, orderBy: { externalKey: "asc" } });
    expect(await send(owner.userId, batch)).toEqual({ status: 200, body: { upserted: 2, deleted: 0 } });
    expect(await prisma.interaction.count({ where: { userId: owner.userId } })).toBe(2);
    expect(first.map((i) => [i.source, i.externalKey, i.kind])).toEqual([
      ["ecpad", key(1), "dinner"],
      ["ecpad", key(2), "dinner"],
    ]);
    // An edited note re-sends the same key with new content.
    await send(owner.userId, { activities: [activity(1, owner.people, { kind: "call", title: "Synthetic call", notes: null })] });
    const edited = await prisma.interaction.findUniqueOrThrow({ where: { userId_externalKey: { userId: owner.userId, externalKey: key(1) } } });
    expect(edited).toMatchObject({ id: first[0].id, kind: "call", title: "Synthetic call", notes: "From EC Pad: Synthetic journal", personIds: owner.people, createdAt: first[0].createdAt });
    // The person's timeline lists it like any other interaction.
    expect(await prisma.interaction.count({ where: { userId: owner.userId, personIds: { has: owner.people[1] } } })).toBe(2);
  });

  it("deletes only the caller's ecpad rows with those keys", async () => {
    await send(owner.userId, { activities: [activity(1, [owner.people[0]]), activity(2, [owner.people[0]])] });
    await send(other.userId, { activities: [activity(1, [other.people[0]])] });
    const manual = await prisma.interaction.create({
      data: { userId: owner.userId, personIds: [owner.people[0]], occurredAt: new Date(), kind: "call", title: "Manual", source: "manual" },
    });
    // A row from another writer that somehow holds the same key must survive.
    await prisma.interaction.create({
      data: { userId: owner.userId, personIds: [], occurredAt: new Date(), kind: "other", title: "Foreign writer", source: "smart-capture", externalKey: key(7) },
    });
    expect(await send(owner.userId, { deleted: [key(1), key(7), key(99)] })).toEqual({ status: 200, body: { upserted: 0, deleted: 1 } });
    expect((await prisma.interaction.findMany({ where: { userId: owner.userId }, select: { externalKey: true } })).map((i) => i.externalKey).sort()).toEqual([key(2), key(7), null].sort());
    expect(await prisma.interaction.findUnique({ where: { id: manual.id } })).not.toBeNull();
    expect(await prisma.interaction.count({ where: { userId: other.userId, externalKey: key(1) } })).toBe(1);
  });

  it("rejects another user's people and writes nothing from that batch", async () => {
    const res = await send(owner.userId, { activities: [activity(1, [owner.people[0]]), activity(2, [other.people[0]])] });
    expect(res).toEqual({ status: 400, body: { error: "Unknown personId" } });
    expect(await prisma.interaction.count({ where: { userId: owner.userId } })).toBe(0);
  });

  it("applies upserts and deletes of different keys in one request", async () => {
    await send(owner.userId, { activities: [activity(1, [owner.people[0]])] });
    expect(await send(owner.userId, { activities: [activity(2, [owner.people[0]])], deleted: [key(1)] })).toEqual({ status: 200, body: { upserted: 1, deleted: 1 } });
    expect((await prisma.interaction.findMany({ where: { userId: owner.userId } })).map((i) => i.externalKey)).toEqual([key(2)]);
  });
});
