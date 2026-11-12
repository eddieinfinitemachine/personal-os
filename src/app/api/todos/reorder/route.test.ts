import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findList: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    list: { findFirst: mocks.findList },
    todo: { updateMany: mocks.updateMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { POST } from "./route";

type Todo = { id: string; listId: string; parentId: string | null; position: number };
type Where = { id: string; listId: string; parentId: null };
let todos: Todo[];
// Lists by id, with the users who can see them (owner or member).
const LISTS: Record<string, string[]> = { mine: ["eddie"], shared: ["shane", "eddie"], theirs: ["shane"] };

const post = (body: unknown) =>
  POST(new Request("https://example.invalid/api/todos/reorder", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const positions = () => Object.fromEntries(todos.map((t) => [t.id, t.position]));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("eddie");
  todos = [
    { id: "a", listId: "mine", parentId: null, position: 0 },
    { id: "b", listId: "mine", parentId: null, position: 1 },
    { id: "c", listId: "mine", parentId: null, position: 2 },
    { id: "sub", listId: "mine", parentId: "a", position: 0 },
    { id: "elsewhere", listId: "theirs", parentId: null, position: 5 },
    { id: "s1", listId: "shared", parentId: null, position: 0 },
    { id: "s2", listId: "shared", parentId: null, position: 1 },
  ];
  // Applies listAccessWhere's owner-or-member rule.
  mocks.findList.mockImplementation(async ({ where }: { where: { id: string; OR: Array<{ userId?: string; members?: { some: { userId: string } } }> } }) => {
    const userId = where.OR[0].userId!;
    expect(where.OR[1]).toEqual({ members: { some: { userId } } });
    return LISTS[where.id]?.includes(userId) ? { id: where.id } : null;
  });
  mocks.updateMany.mockImplementation(({ where, data }: { where: Where; data: { position: number } }) => {
    const hit = todos.filter((t) => t.id === where.id && t.listId === where.listId && t.parentId === where.parentId);
    hit.forEach((t) => (t.position = data.position));
    return { count: hit.length };
  });
  mocks.transaction.mockImplementation(async (ops: unknown[]) => ops);
});

describe("POST /api/todos/reorder", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await post({ listId: "mine", ids: [] })).status).toBe(401);
  });

  it("sets each named todo's position to its index, in one transaction", async () => {
    const res = await post({ listId: "mine", ids: ["c", "a", "b"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(positions()).toMatchObject({ c: 0, a: 1, b: 2 });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(3);
  });

  it("ignores ids outside the list, subtasks, and leaves unnamed todos alone", async () => {
    await post({ listId: "mine", ids: ["elsewhere", "sub", "b", "missing"] });
    // b got index 2; everything else kept its position.
    expect(positions()).toEqual({ a: 0, b: 2, c: 2, sub: 0, elsewhere: 5, s1: 0, s2: 1 });
    for (const [args] of mocks.updateMany.mock.calls) expect(args.where).toMatchObject({ listId: "mine", parentId: null });
  });

  it("lets a member of a shared list reorder it", async () => {
    const res = await post({ listId: "shared", ids: ["s2", "s1"] });
    expect(res.status).toBe(200);
    expect(positions()).toMatchObject({ s2: 0, s1: 1 });
  });

  it("404s a list the caller can't access, without writing", async () => {
    const res = await post({ listId: "theirs", ids: ["elsewhere"] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "list not found" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(positions().elsewhere).toBe(5);
  });

  it.each([
    [{ ids: ["a"] }, "listId required"],
    [{ listId: "", ids: ["a"] }, "listId required"],
    [{ listId: 3, ids: ["a"] }, "listId required"],
    [{ listId: "mine" }, "ids required"],
    [{ listId: "mine", ids: "a,b" }, "ids required"],
    [{ listId: "mine", ids: ["a", 2] }, "ids required"],
    [{ listId: "mine", ids: Array.from({ length: 1001 }, (_, i) => `t${i}`) }, "ids required"],
  ])("400s %j", async (body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(mocks.findList).not.toHaveBeenCalled();
  });

  it.each(["{not json", "[]", "null"])("400s a body that isn't a JSON object: %j", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
  });

  it("accepts an empty ids array as a no-op", async () => {
    const res = await post({ listId: "mine", ids: [] });
    expect(res.status).toBe(200);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
