import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  projectFind: vi.fn(),
  listFindMany: vi.fn(),
  todoFindMany: vi.fn(),
  ensureDefaultLists: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: mocks.projectFind },
    list: { findMany: mocks.listFindMany },
    todo: { findMany: mocks.todoFindMany },
  },
}));
vi.mock("@/lib/lists", () => ({ ensureDefaultLists: mocks.ensureDefaultLists }));
import { findOwnProject, getProjectTasks, hasDashboard, projectSummarySelect, toProjectSummary } from "./project-detail";

const NOW = new Date("2026-11-08T15:00:00Z");
const created = new Date("2026-01-02T03:04:05Z");

const projectRow = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Volvo",
  kind: "vehicle",
  archived: false,
  createdAt: created,
  updatedAt: created,
  userId: "u1",
  vehicle: { id: "v1" },
  pet: null,
  human: null,
  ...over,
});

const todo = (id: string, listId: string, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  notes: null,
  dueDate: null,
  completedAt: null,
  createdAt: created,
  snoozedUntil: null,
  projectId: "p1",
  listId,
  position: 0,
  subtasks: [],
  _count: { attachments: 0 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureDefaultLists.mockResolvedValue(undefined);
});

describe("hasDashboard", () => {
  it("is the page's rule: vehicle, pet and human", () => {
    expect(["vehicle", "pet", "human", "generic", "trip", ""].map(hasDashboard)).toEqual([true, true, true, false, false, false]);
  });
});

describe("toProjectSummary", () => {
  it("carries the record id of each kind", () => {
    expect(toProjectSummary(projectRow())).toEqual({
      id: "p1",
      name: "Volvo",
      kind: "vehicle",
      archived: false,
      createdAt: created,
      updatedAt: created,
      hasDashboard: true,
      vehicleId: "v1",
      petId: null,
      humanId: null,
    });
    expect(toProjectSummary(projectRow({ kind: "generic", vehicle: null }))).toMatchObject({ hasDashboard: false, vehicleId: null });
  });
});

describe("findOwnProject", () => {
  it("returns the caller's project and null for anyone else's or a missing one", async () => {
    mocks.projectFind.mockResolvedValue(projectRow());
    expect(await findOwnProject("u1", "p1")).toMatchObject({ id: "p1" });
    expect(mocks.projectFind).toHaveBeenCalledWith({ where: { id: "p1" }, select: projectSummarySelect });
    expect(await findOwnProject("u2", "p1")).toBeNull();
    mocks.projectFind.mockResolvedValue(null);
    expect(await findOwnProject("u1", "nope")).toBeNull();
  });
});

describe("getProjectTasks", () => {
  it("puts the project's open todos under the caller's three default lists, like the Tasks tab", async () => {
    const lists = ["To Do", "Monitor", "Later"].map((name, i) => ({ id: `l${i}`, name, color: "blue", position: i, isDefault: true }));
    mocks.listFindMany.mockResolvedValue(lists);
    mocks.todoFindMany.mockResolvedValue([
      todo("a", "l0", { _count: { attachments: 2 }, subtasks: [{ id: "s1", title: "s1", notes: null, dueDate: null, completedAt: created, projectId: "p1" }] }),
      todo("b", "l2"),
      todo("custom", "l-custom"),
    ]);
    const tasks = await getProjectTasks("u1", "p1", NOW);

    expect(mocks.ensureDefaultLists).toHaveBeenCalledWith("u1");
    expect(mocks.listFindMany).toHaveBeenCalledWith({
      where: { userId: "u1", isDefault: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    expect(mocks.todoFindMany.mock.calls[0][0].where).toEqual({
      projectId: "p1",
      completedAt: null,
      parentId: null,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: NOW } }],
      list: { OR: [{ userId: "u1" }, { members: { some: { userId: "u1" } } }] },
    });
    expect(tasks.map((t) => [t.list.name, t.todos.map((x) => x.id), t.totalCount])).toEqual([
      ["To Do", ["a"], 1],
      ["Monitor", [], 0],
      ["Later", ["b"], 1],
    ]);
    expect(tasks[0].todos[0]).toMatchObject({ attachmentCount: 2, subtasks: [{ id: "s1", completedAt: created }] });
  });
});
