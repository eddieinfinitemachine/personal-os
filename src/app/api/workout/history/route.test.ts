import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({
  prisma: { workoutLog: { findMany: mocks.findMany, upsert: mocks.upsert }, $transaction: mocks.transaction },
}));
import { GET, POST } from "./route";

const url = "https://example.invalid/api/workout/history";
const post = (body: unknown) => new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const finishedAt = Date.UTC(2026, 9, 16, 18);
const exercises = [{ name: "Goblet squat", equipment: "dumbbell", targetReps: 10, sets: [{ reps: 10, durationSec: null, load: "2×25 lb" }] }];
const record = { id: "w-1", title: "Legs", focus: "lower", startedAt: finishedAt - 1800000, finishedAt, durationMin: 30, exercises };
const missingTable = Object.assign(new Error("The table `WorkoutLog` does not exist"), { code: "P2021" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.upsert.mockImplementation((args: unknown) => args);
  mocks.transaction.mockImplementation(async (ops: unknown[]) => ops);
});

describe("GET /api/workout/history", () => {
  it("returns the user's latest sessions as records", async () => {
    mocks.findMany.mockResolvedValue([
      { clientId: "w-1", title: "Legs", focus: "lower", startedAt: new Date(record.startedAt), finishedAt: new Date(finishedAt), durationMin: 30, exercises },
    ]);
    const res = await GET(new Request(url));
    expect(await res.json()).toEqual({ records: [record], stored: true });
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { userId: "u1" }, orderBy: { finishedAt: "desc" }, take: 30 });
  });
  it("reads an absent table as an empty log, 401 signed out, and rethrows anything else", async () => {
    mocks.findMany.mockRejectedValueOnce(missingTable);
    expect(await (await GET(new Request(url))).json()).toEqual({ records: [], stored: false });
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(new Request(url))).status).toBe(401);
    mocks.findMany.mockRejectedValueOnce(new Error("boom"));
    await expect(GET(new Request(url))).rejects.toThrow("boom");
  });
});

describe("POST /api/workout/history", () => {
  it("upserts each record by the device's session id", async () => {
    const res = await POST(post({ records: [record, { id: "", finishedAt }] }));
    expect(await res.json()).toEqual({ saved: [{ id: "w-1", finishedAt }], stored: true });
    const data = { title: "Legs", focus: "lower", startedAt: new Date(record.startedAt), finishedAt: new Date(finishedAt), durationMin: 30, exercises };
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId_clientId: { userId: "u1", clientId: "w-1" } },
      create: { userId: "u1", clientId: "w-1", ...data },
      update: data,
    });
  });
  it("saves nothing without the table, and rejects bad input and signed-out callers", async () => {
    mocks.transaction.mockRejectedValueOnce(missingTable);
    expect(await (await POST(post({ records: [record] }))).json()).toEqual({ saved: [], stored: false });
    expect((await POST(post("{nope"))).status).toBe(400);
    expect((await POST(post({ records: [{ id: "w-2" }] }))).status).toBe(400);
    expect((await POST(post(null))).status).toBe(400);
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(post({ records: [record] }))).status).toBe(401);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
