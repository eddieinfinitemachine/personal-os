import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  todoUpdateMany: vi.fn(),
  listDelete: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    list: { findFirst: mocks.findFirst, findMany: mocks.findMany, create: mocks.create, update: mocks.update, updateMany: mocks.updateMany, delete: mocks.listDelete },
    todo: { updateMany: mocks.todoUpdateMany },
  },
}));
import { captureListNames, DEFAULT_LISTS, ensureDefaultLists } from "./lists";

type ListRow = { id: string; userId: string; name: string; color: string; position: number; isDefault: boolean; createdAt: number; members: string[] };
type NameFilter = string | { equals: string; mode: "insensitive" };
type Where = { id?: string; userId?: string; isDefault?: boolean; name?: NameFilter; position?: { gte: number }; members?: { none: object }; NOT?: { isDefault: boolean; name: string } };
let lists: ListRow[];
let serial: number;
let userSerial = 0;
// ensureDefaultLists caches per user and process, so each test gets a fresh user.
let user: string;

const nameMatches = (name: NameFilter | undefined, value: string) =>
  name === undefined || (typeof name === "string" ? name === value : name.equals.toLowerCase() === value.toLowerCase());
const matches = (l: ListRow, w: Where) =>
  (w.id === undefined || l.id === w.id) &&
  (w.userId === undefined || l.userId === w.userId) &&
  (w.isDefault === undefined || l.isDefault === w.isDefault) &&
  nameMatches(w.name, l.name) &&
  (w.position === undefined || l.position >= w.position.gte) &&
  (w.members === undefined || l.members.length === 0) &&
  (w.NOT === undefined || !(l.isDefault === w.NOT.isDefault && l.name === w.NOT.name));
const add = (over: Partial<ListRow>) => {
  const row = { id: `list-${++serial}`, userId: user, name: "List", color: "zinc", position: 0, isDefault: false, createdAt: serial, members: [], ...over };
  lists.push(row);
  return row;
};
const order = () => lists.filter((l) => l.userId === user).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt).map((l) => l.name);

beforeEach(() => {
  vi.clearAllMocks();
  lists = [];
  serial = 0;
  user = `user-${++userSerial}`;
  mocks.findFirst.mockImplementation(async ({ where }: { where: Where }) => lists.filter((l) => matches(l, where)).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null);
  mocks.create.mockImplementation(async ({ data }: { data: Partial<ListRow> }) => add(data));
  mocks.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<ListRow> }) => Object.assign(lists.find((l) => l.id === where.id)!, data));
  mocks.updateMany.mockImplementation(async ({ where, data }: { where: Where; data: { position: { increment: number } } }) => {
    const hit = lists.filter((l) => matches(l, where));
    hit.forEach((l) => (l.position += data.position.increment));
    return { count: hit.length };
  });
});

describe("DEFAULT_LISTS", () => {
  it("has Inbox directly after To Do", () => {
    expect(DEFAULT_LISTS.map((l) => [l.name, l.position, l.color])).toEqual([
      ["To Do", 0, "blue"],
      ["Inbox", 1, "zinc"],
      ["Monitor", 2, "orange"],
      ["Later", 3, "violet"],
    ]);
  });
});

describe("ensureDefaultLists", () => {
  it("gives a new account To Do, Inbox, Monitor, Later in that order", async () => {
    await ensureDefaultLists(user);
    expect(order()).toEqual(["To Do", "Inbox", "Monitor", "Later"]);
    expect(lists.every((l) => l.isDefault)).toBe(true);
  });

  it("adds Inbox after To Do for an existing account, keeping custom lists in their order", async () => {
    add({ name: "To Do", color: "blue", position: 0, isDefault: true });
    add({ name: "Monitor", color: "orange", position: 1, isDefault: true });
    add({ name: "Later", color: "violet", position: 2, isDefault: true });
    add({ name: "Garage", position: 3 });
    add({ name: "Wedding", position: 4 });
    // A list reordered above Monitor stays above it.
    add({ name: "Work", position: 1 });
    await ensureDefaultLists(user);
    expect(order()).toEqual(["To Do", "Inbox", "Monitor", "Work", "Later", "Garage", "Wedding"]);
    expect(lists.find((l) => l.name === "Inbox")).toMatchObject({ isDefault: true, color: "zinc", position: 1 });
    expect(lists.filter((l) => l.name === "Inbox")).toHaveLength(1);
  });

  it("only makes room once", async () => {
    await ensureDefaultLists(user);
    const before = lists.map((l) => [l.name, l.position]);
    mocks.updateMany.mockClear();
    // A different process (no cache) checks the same account again.
    vi.resetModules();
    const fresh = await import("./lists");
    await fresh.ensureDefaultLists(user);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(lists.map((l) => [l.name, l.position])).toEqual(before);
  });

  it("adopts a list the user already called Inbox instead of adding a second one", async () => {
    add({ name: "To Do", color: "blue", position: 0, isDefault: true });
    const mine = add({ name: "inbox", color: "rose", position: 5 });
    await ensureDefaultLists(user);
    expect(lists.filter((l) => l.name.toLowerCase() === "inbox")).toHaveLength(1);
    expect(mine).toMatchObject({ name: "Inbox", isDefault: true, color: "zinc", position: 1 });
    expect(order().slice(0, 2)).toEqual(["To Do", "Inbox"]);
  });

  it("keeps a shared list called Inbox custom and adds the default one", async () => {
    const shared = add({ name: "Inbox", position: 3, members: ["shane"] });
    await ensureDefaultLists(user);
    expect(shared.isDefault).toBe(false);
    expect(lists.filter((l) => l.name === "Inbox" && l.isDefault)).toHaveLength(1);
  });

  it("no longer folds an Inbox list into To Do", async () => {
    add({ name: "To Do", color: "blue", position: 0, isDefault: true });
    const inbox = add({ name: "Inbox", color: "zinc", position: 1, isDefault: true });
    await ensureDefaultLists(user);
    expect(lists).toContain(inbox);
    expect(mocks.listDelete).not.toHaveBeenCalled();
    expect(mocks.todoUpdateMany).not.toHaveBeenCalled();
  });
});

describe("captureListNames", () => {
  it("lists the user's own and editable shared lists, Inbox left out, each name once", async () => {
    mocks.findMany.mockResolvedValue([{ name: "To Do" }, { name: "Inbox" }, { name: "Monitor" }, { name: "Garage " }, { name: "garage" }, { name: "Wedding" }]);
    expect(await captureListNames("eddie")).toEqual(["To Do", "Monitor", "Garage", "Wedding"]);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ userId: "eddie" }, { isDefault: false, members: { some: { userId: "eddie", role: { in: ["editor", "admin"] } } } }],
    });
  });
});
