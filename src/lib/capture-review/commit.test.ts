import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { commitCore, validateCoreProposal } from "./commit";
function client() {
  let serial = 0;
  const create = vi.fn(async ({ data }) => ({ id: `row-${++serial}`, ...data }));
  const tx = {
    list: { findFirst: vi.fn(async () => ({ id: "list", name: "To Do" })), create },
    project: { findFirst: vi.fn(async () => ({ id: "project", name: "Inbox" })), create },
    todo: { create, update: vi.fn(), aggregate: vi.fn(async () => ({ _max: { position: null } })) }, asset: { create }, trip: { create }, interaction: { create },
    person: { findFirst: vi.fn(async () => null), create, update: vi.fn(), updateMany: vi.fn() },
    attachment: { findFirst: vi.fn(async () => ({ id: "attachment", userId: "alice", url: "https://blob.example/file" })), create: vi.fn(), update: vi.fn() },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, raw: tx, create };
}
describe("core capture commit", () => {
  it.each([
    { type: "todo", title: "X", dueDate: "2026-02-31" },
    { type: "person", firstName: "X", circles: [3] },
    { type: "asset", title: "X", assetKind: "media", url: "javascript:alert(1)" },
    { type: "trip", name: "X", costUsd: "10" },
    { type: "interaction", title: "X", kind: "meeting", occurredAt: "2026-11-01", personHints: [{ firstName: 3 }] },
  ])("rejects malformed proposals before any write: %j", async proposal => {
    const { tx, create } = client();
    expect(() => validateCoreProposal(proposal)).toThrow();
    await expect(commitCore(tx, "alice", { text: "", url: null }, proposal as never, [])).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("transfers original attachment metadata instead of creating a second attachment", async () => {
    const { tx, raw } = client();
    const result = await commitCore(tx, "alice", { text: "shared", url: null }, { type: "asset", assetKind: "inventory", title: "Camera" }, [{ file: { name: "manual.pdf", type: "application/pdf", size: 20 }, url: "https://blob.example/file", attachmentId: "attachment" }], { mode: "correction" });
    expect(raw.attachment.create).not.toHaveBeenCalled();
    expect(raw.attachment.update).toHaveBeenCalledWith({ where: { id: "attachment" }, data: { todoId: null, projectId: null, assetId: result.id } });
  });
  it("retains mobile companion tasks while web person saves only create a person", async () => {
    const mobile = client();
    await commitCore(mobile.tx, "alice", { text: "Maya", url: null }, { type: "person", firstName: "Maya" }, [], { mode: "mobile" });
    expect(mobile.create.mock.calls.map(([x]) => x.data.title)).toContain("Follow up with Maya");
    const web = client();
    await commitCore(web.tx, "alice", { text: "Maya", url: null }, { type: "person", firstName: "Maya" }, [], { mode: "web" });
    expect(web.create).toHaveBeenCalledTimes(1);
  });
  it("rejects inaccessible explicit correction destinations before writes", async () => {
    const { tx, raw, create } = client();
    raw.list.findFirst.mockResolvedValue(null as never);
    await expect(commitCore(tx, "alice", { text: "", url: null }, { type: "todo", title: "Task" }, [], { mode: "correction", listId: "someone-elses-list" })).rejects.toMatchObject({ status: 404 });
    expect(create).not.toHaveBeenCalled();
  });
});

type ListRow = { id: string; name: string; userId: string; isDefault: boolean; createdAt: number; members: Array<{ userId: string; role: string }> };
type Where = Record<string, unknown>;
/** A small in-memory list + todo store that answers the queries commit makes. */
function store() {
  let serial = 0;
  const lists: ListRow[] = [
    { id: "todo", name: "To Do", userId: "alice", isDefault: true, createdAt: 1, members: [] },
    { id: "inbox", name: "Inbox", userId: "alice", isDefault: true, createdAt: 2, members: [] },
    { id: "monitor", name: "Monitor", userId: "alice", isDefault: true, createdAt: 3, members: [] },
    { id: "later", name: "Later", userId: "alice", isDefault: true, createdAt: 4, members: [] },
    { id: "garage", name: "Garage", userId: "alice", isDefault: false, createdAt: 5, members: [] },
    { id: "wedding", name: "Wedding", userId: "bob", isDefault: false, createdAt: 6, members: [{ userId: "alice", role: "editor" }] },
    { id: "book-club", name: "Book Club", userId: "bob", isDefault: false, createdAt: 7, members: [{ userId: "alice", role: "viewer" }] },
  ];
  const todos: Array<Record<string, unknown>> = [];
  const matchName = (name: unknown, value: string) => typeof name === "string" ? name === value : !name || (name as { equals: string }).equals.toLowerCase() === value.toLowerCase();
  const matches = (l: ListRow, w: Where) =>
    (w.id === undefined || l.id === w.id) && (w.userId === undefined || l.userId === w.userId) &&
    (w.isDefault === undefined || l.isDefault === w.isDefault) && matchName(w.name, l.name) &&
    (w.members === undefined || l.members.some(m => { const some = (w.members as { some: { userId: string; role: { in: string[] } } }).some; return m.userId === some.userId && some.role.in.includes(m.role); }));
  const tx = {
    list: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => lists.filter(l => matches(l, where)).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt - b.createdAt)[0] ?? null),
      create: vi.fn(async ({ data }: { data: Omit<ListRow, "id" | "createdAt" | "members"> }) => { const row = { id: `list-${++serial}`, createdAt: 100 + serial, members: [], ...data }; lists.push(row); return row; }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    project: { findFirst: vi.fn(async () => ({ id: "inbox-project", name: "Inbox" })), create: vi.fn() },
    todo: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `todo-${++serial}`, ...data }; todos.push(row); return row; }),
      aggregate: vi.fn(async ({ where }: { where: { listId: string; parentId: null } }) => {
        const positions = todos.filter(t => t.listId === where.listId && !t.parentId).map(t => Number(t.position));
        return { _max: { position: positions.length ? Math.max(...positions) : null } };
      }),
    },
    asset: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `asset-${++serial}`, ...data })) },
    attachment: { create: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(async () => []),
  };
  return { tx: tx as unknown as Prisma.TransactionClient, raw: tx, lists, todos };
}
const todo = (extra: Record<string, unknown> = {}) => ({ type: "todo" as const, title: "Fix the hinge", ...extra });

describe("captured todos land in Inbox with a list suggestion", () => {
  it.each([
    ["Later", "later"],
    ["Monitor", "monitor"],
    ["To Do", "todo"],
    [undefined, "todo"],
    [null, "todo"],
    ["  ", "todo"],
    ["garage", "garage"],
    ["WEDDING", "wedding"],
  ])("stores the AI's %j as suggestion %s", async (listName, suggested) => {
    const { tx, todos } = store();
    const result = await commitCore(tx, "alice", { text: "fix the hinge", url: null }, todo({ listName }), [], { mode: "mobile" });
    expect(result).toMatchObject({ type: "todo", destination: "Inbox", path: "/" });
    expect(todos[0]).toMatchObject({ listId: "inbox", suggestedListId: suggested, projectId: "inbox-project", position: 0 });
  });

  it.each(["Groceries", "Book Club", "Inbox", "inbox"])("suggests nothing for %j (unknown, read-only, or the Inbox itself) and creates no list", async listName => {
    const { tx, raw, todos } = store();
    await commitCore(tx, "alice", { text: "", url: null }, todo({ listName }), [], { mode: "auto" });
    expect(todos[0]).toMatchObject({ listId: "inbox", suggestedListId: null });
    expect(raw.list.create).not.toHaveBeenCalled();
  });

  it("re-creates a missing default list for its suggestion, as a capture destination would be", async () => {
    const { tx, lists, todos } = store();
    lists.splice(lists.findIndex(l => l.id === "later"), 1);
    await commitCore(tx, "alice", { text: "", url: null }, todo({ listName: "later" }), [], { mode: "mobile" });
    const later = lists.find(l => l.name === "Later")!;
    expect(later).toMatchObject({ isDefault: true, userId: "alice", position: 3 });
    expect(todos[0].suggestedListId).toBe(later.id);
  });

  it("puts each new capture after the Inbox's existing todos", async () => {
    const { tx, todos } = store();
    todos.push({ id: "old", listId: "inbox", parentId: null, position: 4 }, { id: "sub", listId: "inbox", parentId: "old", position: 9 });
    await commitCore(tx, "alice", { text: "", url: null }, todo(), [], { mode: "mobile" });
    await commitCore(tx, "alice", { text: "", url: null }, todo({ title: "Second" }), [], { mode: "mobile" });
    expect(todos.slice(2).map(t => [t.title, t.position])).toEqual([["Fix the hinge", 5], ["Second", 6]]);
  });

  it("files an @alias capture straight into its list, last, with no suggestion", async () => {
    const { tx, todos } = store();
    todos.push({ id: "old", listId: "garage", parentId: null, position: 2 });
    const result = await commitCore(tx, "alice", { text: "@garage fix the hinge", url: null }, todo({ listName: "Garage", routedByAlias: true }), [], { mode: "auto" });
    expect(result.destination).toBe("Garage");
    expect(todos[1]).toMatchObject({ listId: "garage", position: 3 });
    expect(todos[1]).not.toHaveProperty("suggestedListId");
  });

  it("files into an explicit list (Inbox correction, quick todo with a list) with no suggestion", async () => {
    const { tx, todos } = store();
    const result = await commitCore(tx, "alice", { text: "", url: null }, todo({ listName: "Later" }), [], { mode: "correction", listId: "monitor" });
    expect(result.destination).toBe("Monitor");
    expect(todos[0]).toMatchObject({ listId: "monitor", position: 0 });
    expect(todos[0]).not.toHaveProperty("suggestedListId");
  });

  it("lands a Read/Watch companion in Inbox suggesting Later, keeping the asset's project", async () => {
    const { tx, todos } = store();
    const result = await commitCore(tx, "alice", { text: "", url: "https://example.invalid/film" }, { type: "asset", assetKind: "media", title: "Synthetic Film", status: "to-watch", projectId: null, details: { format: "film" } }, [], { mode: "mobile" });
    expect(result.related).toEqual([expect.objectContaining({ type: "todo", title: "Watch: Synthetic Film", destination: "Inbox" })]);
    expect(todos[0]).toMatchObject({ listId: "inbox", suggestedListId: "later", projectId: null });
  });

  it("lands a person's follow-up in Inbox suggesting To Do", async () => {
    const { tx, raw, todos } = store();
    Object.assign(raw, { person: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "person-1", ...data })) } });
    const result = await commitCore(tx, "alice", { text: "Met Sam", url: null }, { type: "person", firstName: "Sam" }, [], { mode: "mobile" });
    expect(result.related?.[0]).toMatchObject({ title: "Follow up with Sam", destination: "Inbox" });
    expect(todos[0]).toMatchObject({ listId: "inbox", suggestedListId: "todo", projectId: "inbox-project" });
  });
});
