import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findMany: mocks.findMany },
    interaction: { upsert: mocks.upsert, deleteMany: mocks.deleteMany },
    $transaction: mocks.transaction,
  },
}));
import { POST } from "./route";

const key = (n: number) => `ecpad:${n.toString(16).padStart(64, "0")}`;
const recent = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 19) + "Z";
const activity = {
  externalKey: key(1),
  personIds: ["p1", "p2"],
  occurredAt: recent,
  kind: "dinner",
  title: "Dinner with Alex Rivera and Sam",
  notes: "“same place next month”",
  sourceTitle: "Journal",
  sourceRef: "ecpad://note/Journal.md",
};
const req = (body: unknown, auth = "Bearer token") =>
  new Request("https://example.invalid/api/capture/activities", {
    method: "POST",
    headers: { authorization: auth },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue("owner");
  mocks.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => id.startsWith("p")).map((id) => ({ id })),
  );
  // Each builder returns a description of the query; $transaction "runs" them.
  mocks.upsert.mockImplementation((args: unknown) => ({ op: "upsert", args }));
  mocks.deleteMany.mockImplementation((args: unknown) => ({ op: "deleteMany", args }));
  mocks.transaction.mockImplementation(async (ops: { op: string }[]) =>
    ops.map((op) => (op.op === "deleteMany" ? { count: 1 } : { id: "i" })),
  );
});

describe("POST /api/capture/activities", () => {
  it("requires the capture bearer", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    const res = await POST(req({ activities: [activity] }, ""));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects bad bodies, unknown fields, big batches and oversized requests", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req({ activities: [{ ...activity, extra: 1 }] }))).status).toBe(400);
    expect((await POST(req({ activities: [{ ...activity, occurredAt: "2026-10-01" }] }))).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => ({ ...activity, externalKey: key(i) }));
    expect((await POST(req({ activities: many }))).status).toBe(413);
    expect((await POST(req("x".repeat(161_000)))).status).toBe(413);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects people that do not belong to the caller", async () => {
    const res = await POST(req({ activities: [{ ...activity, personIds: ["p1", "someone-elses"] }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown personId" });
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { userId: "owner", id: { in: ["p1", "someone-elses"] } }, select: { id: true } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("upserts by (userId, externalKey) as source ecpad and deletes only the caller's ecpad rows", async () => {
    const res = await POST(req({ activities: [activity], deleted: [key(9)] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ upserted: 1, deleted: 1 });
    const data = {
      occurredAt: new Date(recent),
      kind: "dinner",
      title: "Dinner with Alex Rivera and Sam",
      notes: "“same place next month”\n\nFrom EC Pad: Journal",
      personIds: ["p1", "p2"],
    };
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId_externalKey: { userId: "owner", externalKey: key(1) } },
      create: { ...data, userId: "owner", externalKey: key(1), source: "ecpad" },
      update: data,
      select: { id: true },
    });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { userId: "owner", source: "ecpad", externalKey: { in: [key(9)] } },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("supports delete-only requests without a person lookup", async () => {
    mocks.transaction.mockResolvedValueOnce([{ count: 0 }]);
    expect(await (await POST(req({ deleted: [key(3)] }))).json()).toEqual({ upserted: 0, deleted: 0 });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("answers a concurrent first insert with a retryable 409 and hides other failures", async () => {
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" }));
    expect((await POST(req({ activities: [activity] }))).status).toBe(409);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.transaction.mockRejectedValueOnce(new Error("db down: secret detail"));
    const res = await POST(req({ activities: [activity] }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(quiet).toHaveBeenCalledWith("activities capture failed");
    quiet.mockRestore();
  });
});
