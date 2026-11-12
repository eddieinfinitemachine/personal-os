import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findList: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  aggregate: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    list: { findFirst: mocks.findList },
    todo: { findUnique: mocks.findUnique, findFirst: mocks.findFirst, aggregate: mocks.aggregate, create: mocks.create, createMany: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
import { POST } from "./route";

const restore = (todo: Record<string, unknown>) =>
  POST(new Request("https://example.invalid/api/todos/restore", { method: "POST", body: JSON.stringify({ todo }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("eddie");
  mocks.findList.mockResolvedValue({ id: "inbox" });
  mocks.findUnique.mockResolvedValue(null);
  mocks.findFirst.mockResolvedValue({ id: "parent" });
  mocks.aggregate.mockResolvedValue({ _max: { position: 3 } });
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "r", ...data }));
});

describe("POST /api/todos/restore: position", () => {
  it("keeps a snapshot's own position", async () => {
    await restore({ id: "t1", title: "Call the bank", listId: "inbox", position: 1 });
    expect(mocks.create.mock.calls[0][0].data.position).toBe(1);
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });

  it("puts a top-level todo without one after the list's todos", async () => {
    await restore({ id: "t1", title: "Call the bank", listId: "inbox" });
    expect(mocks.aggregate).toHaveBeenCalledWith({ where: { listId: "inbox", parentId: null }, _max: { position: true } });
    expect(mocks.create.mock.calls[0][0].data.position).toBe(4);
  });

  it("leaves a subtask without one at 0", async () => {
    await restore({ id: "s1", title: "Find the number", listId: "inbox", parentId: "parent" });
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ parentId: "parent", position: 0 });
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });
});
