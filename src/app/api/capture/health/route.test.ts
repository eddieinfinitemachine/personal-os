import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  bearer: vi.fn(),
  human: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.session }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.bearer }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    human: { findFirst: mocks.human },
    nutritionDay: { upsert: mocks.upsert },
    biometricReading: { deleteMany: mocks.deleteMany, create: mocks.create },
    $transaction: mocks.transaction,
  },
}));
import { POST } from "./route";

const req = (body: unknown, auth = "Bearer token") =>
  new Request("https://example.invalid/api/capture/health", {
    method: "POST",
    headers: { authorization: auth },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const send = {
  app: "Food App",
  date: "2030-06-14",
  calories: "2,105",
  protein: 152,
  fiber: 31,
  hrv: 58,
  restingHeartRate: 52,
};
const values = {
  caloriesKcal: 2105,
  proteinG: 152,
  carbsG: null,
  fatG: null,
  saturatedFatG: null,
  fiberG: 31,
  sugarG: null,
  sodiumMg: null,
};
const missingTable = () =>
  new Prisma.PrismaClientKnownRequestError("The table `public.NutritionDay` does not exist", { code: "P2021", clientVersion: "6" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.bearer.mockResolvedValue("owner");
  mocks.human.mockResolvedValue({ id: "h1" });
  // Each builder returns a description of the query; $transaction "runs" them.
  mocks.upsert.mockImplementation((args: unknown) => ({ op: "upsert", args }));
  mocks.deleteMany.mockImplementation((args: unknown) => ({ op: "deleteMany", args }));
  mocks.create.mockImplementation((args: unknown) => ({ op: "create", args }));
  mocks.transaction.mockImplementation(async (ops: unknown[]) => ops.map(() => ({})));
});

describe("POST /api/capture/health", () => {
  it("requires a session or the capture bearer", async () => {
    mocks.bearer.mockResolvedValueOnce(null);
    const res = await POST(req(send, ""));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts a signed-in user without a bearer", async () => {
    mocks.session.mockResolvedValueOnce("session-user");
    const res = await POST(req({ date: "2030-06-14", calories: 2000 }, ""));
    expect(res.status).toBe(200);
    expect(mocks.bearer).not.toHaveBeenCalled();
    expect(mocks.upsert.mock.calls[0][0].where).toEqual({
      userId_date: { userId: "session-user", date: new Date("2030-06-14T00:00:00Z") },
    });
  });

  it("upserts each day by (userId, date) with the app, in one transaction with the readings", async () => {
    const res = await POST(req(send));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ days: 1, readings: 2, stored: true });
    const date = new Date("2030-06-14T00:00:00Z");
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId_date: { userId: "owner", date } },
      create: { userId: "owner", date, source: "apple-health", ...values, app: "Food App" },
      update: { ...values, app: "Food App" },
    });
    expect(mocks.human).toHaveBeenCalledWith({
      where: { project: { userId: "owner", archived: false } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][0].map((op: { op: string }) => op.op)).toEqual([
      "upsert",
      "deleteMany",
      "create",
      "deleteMany",
      "create",
    ]);
  });

  it("leaves a day's app alone when the send doesn't name one", async () => {
    await POST(req({ date: "2030-06-14", calories: 2000 }));
    const { create, update } = mocks.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty("app");
    expect(create).not.toHaveProperty("app");
  });

  it("replaces the same day's Apple Health reading of each kind", async () => {
    await POST(req({ date: "2030-06-14", hrv: 58 }));
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        humanId: "h1",
        kind: "hrv",
        source: "apple-health",
        measuredAt: { gte: new Date("2030-06-14T00:00:00Z"), lt: new Date("2030-06-15T00:00:00Z") },
      },
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        userId: "owner",
        humanId: "h1",
        measuredAt: new Date("2030-06-14T12:00:00Z"),
        kind: "hrv",
        value: 58,
        unit: "ms",
        source: "apple-health",
      },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("saves the days and skips readings without a Human", async () => {
    mocks.human.mockResolvedValueOnce(null);
    const res = await POST(req(send));
    expect(await res.json()).toEqual({ days: 1, readings: 0, stored: true, reason: "no-human" });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it("still saves the readings when the NutritionDay table is absent", async () => {
    mocks.transaction.mockRejectedValueOnce(missingTable());
    const res = await POST(req(send));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ days: 0, readings: 2, stored: false });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.transaction.mock.calls[1][0].map((op: { op: string }) => op.op)).toEqual([
      "deleteMany",
      "create",
      "deleteMany",
      "create",
    ]);
  });

  it("rejects bad, empty and oversized bodies", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req("[1"))).status).toBe(400);
    const nothing = await POST(req({ date: "2030-06-14" }));
    expect(nothing.status).toBe(400);
    expect((await nothing.json()).error).toMatch(/Nothing to save/);
    expect((await POST(req({ pad: "x".repeat(257 * 1024) }))).status).toBe(413);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("hides other failures and never logs the data", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.transaction.mockRejectedValueOnce(new Error("db down: secret detail"));
    const res = await POST(req(send));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(quiet).toHaveBeenCalledWith("health capture failed");
    quiet.mockRestore();
  });
});
