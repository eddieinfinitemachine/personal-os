import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { acceptRecord, acceptManifest, cleanupSource } from "./store";
import { hash } from "./contracts";
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
describe.skipIf(!enabled)("durable intake in Postgres", () => {
  let userId: string, other: string, stateId: string;
  const env = (text = "a", extra = {}) => ({
    version: 1,
    externalId: "n",
    revision: hash(text),
    documentVersion: 1,
    segmentIndex: 0,
    segmentCount: 1,
    text,
    title: "Journal",
    occurredAt: null,
    url: null,
    identities: [],
    evidenceFamily: null,
    ...extra,
  });
  beforeEach(async () => {
    userId = randomUUID();
    other = randomUUID();
    await prisma.user.createMany({
      data: [userId, other].map((id) => ({
        id,
        email: `${id}@example.invalid`,
      })),
    });
    stateId = (
      await prisma.datingSourceState.create({
        data: { userId, source: "ecpad", enabled: true },
      })
    ).id;
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, other] } } });
  });
  afterAll(() => prisma.$disconnect());
  it("waits for all segments and handles retries and reverse order", async () => {
    const base = { revision: hash("ab"), segmentCount: 2 };
    expect(
      (
        await acceptRecord(
          userId,
          stateId,
          env("b", { ...base, segmentIndex: 1 }),
        )
      ).complete,
    ).toBe(false);
    await acceptRecord(userId, stateId, env("b", { ...base, segmentIndex: 1 }));
    expect((await acceptRecord(userId, stateId, env("a", base))).complete).toBe(
      true,
    );
    expect(
      await prisma.datingSourceRecord.count({
        where: { stateId, status: "pending" },
      }),
    ).toBe(2);
    await expect(acceptRecord(other, stateId, env())).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects altered equal versions and stale arrivals; newer revisions invalidate old records", async () => {
    await acceptRecord(userId, stateId, env());
    await expect(acceptRecord(userId, stateId, env("x"))).rejects.toMatchObject(
      { status: 409 },
    );
    await acceptRecord(userId, stateId, env("b", { documentVersion: 2 }));
    await expect(acceptRecord(userId, stateId, env())).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await prisma.datingSourceRecord.count({
        where: { stateId, status: "superseded" },
      }),
    ).toBe(1);
  });
  it("does not withdraw on partial manifests or unavailable files", async () => {
    await acceptRecord(userId, stateId, env());
    await acceptManifest(userId, stateId, {
      version: 1,
      generation: 1,
      complete: false,
      documents: [],
      unavailableIds: [],
    });
    await acceptManifest(userId, stateId, {
      version: 1,
      generation: 2,
      complete: true,
      documents: [],
      unavailableIds: ["n"],
    });
    expect(
      await prisma.datingSourceRecord.count({
        where: { stateId, status: "pending" },
      }),
    ).toBe(1);
    await expect(
      acceptManifest(userId, stateId, {
        version: 1,
        generation: 2,
        complete: true,
        documents: [],
        unavailableIds: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await acceptManifest(userId, stateId, {
      version: 1,
      generation: 3,
      complete: true,
      documents: [],
      unavailableIds: [],
    });
    expect(
      await prisma.datingSourceRecord.count({
        where: {
          stateId,
          status: "withdrawn",
          payload: { equals: Prisma.DbNull },
        },
      }),
    ).toBe(1);
  });
  it("expires incomplete input visibly without claiming success", async () => {
    await acceptRecord(
      userId,
      stateId,
      env("a", { segmentCount: 2, revision: hash("ab") }),
    );
    expect(
      await cleanupSource(userId, stateId, new Date(Date.now() + 86400001)),
    ).toBe(1);
    const s = await prisma.datingSourceState.findUniqueOrThrow({
      where: { id: stateId },
    });
    expect(s.lastSuccessAt).toBeNull();
    expect(s.status).toBe("needs_attention");
  });
});
