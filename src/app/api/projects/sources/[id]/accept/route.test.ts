import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findUnique: vi.fn(),
  transaction: vi.fn(),
  tx: {
    projectSource: { updateMany: vi.fn(), update: vi.fn() },
    project: { aggregate: vi.fn(), create: vi.fn() },
    projectMeeting: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { projectSource: { findUnique: mocks.findUnique }, $transaction: mocks.transaction },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { POST } from "./route";

const req = () => new Request("https://example.invalid/api/projects/sources/t1/accept", { method: "POST" });
const ctx = { params: Promise.resolve({ id: "t1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.findUnique.mockResolvedValue({ id: "t1", userId: "u1", kind: "topic", state: "suggested", name: "Series A" });
  mocks.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mocks.tx));
  mocks.tx.projectSource.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.project.aggregate.mockResolvedValue({ _max: { position: 6 } });
  mocks.tx.project.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "p_new", ...data }));
  mocks.tx.projectMeeting.updateMany.mockResolvedValue({ count: 2 });
});

describe("POST /api/projects/sources/[id]/accept", () => {
  it("creates the Project last, marks the topic accepted and re-points its meetings, in one transaction", async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).project).toMatchObject({ id: "p_new", name: "Series A", position: 7 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.tx.projectSource.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", state: "suggested" },
      data: { state: "accepted" },
    });
    expect(mocks.tx.project.create.mock.calls[0][0].data).toEqual({
      userId: "u1", name: "Series A", icon: "Folder", color: "neutral", position: 7,
    });
    expect(mocks.tx.projectSource.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { projectId: "p_new" } });
    expect(mocks.tx.projectMeeting.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", sourceId: "t1" },
      data: { projectId: "p_new" },
    });
  });

  it("starts positions at 0 when the user has no Projects", async () => {
    mocks.tx.project.aggregate.mockResolvedValue({ _max: { position: null } });
    await POST(req(), ctx);
    expect(mocks.tx.project.create.mock.calls[0][0].data.position).toBe(0);
  });

  it("only accepts the owner's suggested topics", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(req(), ctx)).status).toBe(401);
    mocks.findUnique.mockResolvedValueOnce({ id: "t1", userId: "other", kind: "topic", state: "suggested" });
    expect((await POST(req(), ctx)).status).toBe(404);
    for (const src of [
      { kind: "topic", state: "candidate" },
      { kind: "topic", state: "dismissed" },
      { kind: "topic", state: "accepted" },
      { kind: "repo", state: "auto" },
    ]) {
      mocks.findUnique.mockResolvedValueOnce({ id: "t1", userId: "u1", name: "x", ...src });
      expect((await POST(req(), ctx)).status).toBe(400);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("409s (creating nothing) when a concurrent accept already claimed it", async () => {
    mocks.tx.projectSource.updateMany.mockResolvedValue({ count: 0 });
    expect((await POST(req(), ctx)).status).toBe(409);
    expect(mocks.tx.project.create).not.toHaveBeenCalled();
  });
});
