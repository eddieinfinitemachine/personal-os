import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findTodos: vi.fn(),
  findComments: vi.fn(),
  findReads: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    todo: { findMany: mocks.findTodos },
    comment: { findMany: mocks.findComments },
    commentRead: { findMany: mocks.findReads },
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifySharedListAdd: vi.fn() }));
import { GET } from "./route";

const req = (query = "") => new Request(`https://example.invalid/api/todos${query}`);
const created = new Date("2026-11-01T09:00:00Z");

const todoRow = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "Book the venue",
  notes: null,
  dueDate: null,
  completedAt: null,
  createdAt: created,
  listId: "shared-list",
  projectId: null,
  project: null,
  droppedAt: null,
  isReference: false,
  snoozedUntil: null,
  lastDiscussedAt: null,
  discussCount: 0,
  user: { name: "Shane", email: "shane@example.invalid" },
  _count: { attachments: 2 },
  subtasks: [
    {
      id: "s1",
      title: "Call them",
      notes: null,
      dueDate: null,
      completedAt: null,
      user: { name: null, email: "eddie@example.invalid" },
    },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("eddie");
  mocks.findTodos.mockResolvedValue([
    todoRow(),
    todoRow({ id: "t2", title: "Pay deposit", user: null, _count: { attachments: 0 }, subtasks: [] }),
  ]);
  mocks.findComments.mockResolvedValue([
    { todoId: "t1", authorId: "shane", createdAt: new Date("2026-11-01T10:00:00Z") },
    { todoId: "t1", authorId: "shane", createdAt: new Date("2026-11-01T12:00:00Z") },
    { todoId: "t1", authorId: "eddie", createdAt: new Date("2026-11-01T13:00:00Z") },
  ]);
  mocks.findReads.mockResolvedValue([
    { todoId: "t1", lastReadAt: new Date("2026-11-01T11:00:00Z") },
  ]);
});

describe("GET /api/todos", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(req())).status).toBe(401);
    expect(mocks.findTodos).not.toHaveBeenCalled();
  });

  it("adds the Home's creator, attachment and comment metadata to each todo", async () => {
    const { todos } = await (await GET(req())).json();
    expect(todos[0]).toMatchObject({
      id: "t1",
      creatorName: "Shane",
      attachmentCount: 2,
      commentCount: 3,
      // Shane's 12:00 comment is after the 11:00 read; Eddie's own never counts.
      unreadCommentCount: 1,
    });
    expect(todos[0].subtasks).toEqual([
      {
        id: "s1",
        title: "Call them",
        notes: null,
        dueDate: null,
        completedAt: null,
        creatorName: "eddie@example.invalid",
      },
    ]);
    expect(todos[1]).toMatchObject({
      id: "t2",
      creatorName: null,
      attachmentCount: 0,
      commentCount: 0,
      unreadCommentCount: 0,
    });
  });

  it("keeps every existing field", async () => {
    const { todos } = await (await GET(req())).json();
    expect(todos[0]).toEqual({
      id: "t1",
      title: "Book the venue",
      notes: null,
      dueDate: null,
      completedAt: null,
      createdAt: created.toISOString(),
      listId: "shared-list",
      projectId: null,
      projectName: null,
      droppedAt: null,
      isReference: false,
      snoozedUntil: null,
      lastDiscussedAt: null,
      discussCount: 0,
      creatorName: "Shane",
      attachmentCount: 2,
      commentCount: 3,
      unreadCommentCount: 1,
      subtasks: [expect.objectContaining({ id: "s1" })],
    });
  });

  it("reads comments and read markers once for the same set of todos", async () => {
    await GET(req("?listId=shared-list"));
    expect(mocks.findComments).toHaveBeenCalledTimes(1);
    expect(mocks.findReads).toHaveBeenCalledTimes(1);
    const todoWhere = mocks.findTodos.mock.calls[0][0].where;
    expect(todoWhere).toMatchObject({ listId: "shared-list", parentId: null, completedAt: null });
    expect(mocks.findComments.mock.calls[0][0].where).toEqual({ todo: todoWhere });
    expect(mocks.findReads.mock.calls[0][0].where).toEqual({ userId: "eddie", todo: todoWhere });
    expect(mocks.findTodos.mock.calls[0][0].include).toMatchObject({
      _count: { select: { attachments: true } },
      user: { select: { name: true, email: true } },
      subtasks: { include: { user: { select: { name: true, email: true } } } },
    });
  });
});
