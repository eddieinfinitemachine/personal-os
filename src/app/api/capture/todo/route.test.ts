import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  commitCore: vi.fn(),
  listFirst: vi.fn(),
  listCreate: vi.fn(),
  projectFirst: vi.fn(),
  todoUpdate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: vi.fn(async () => "alice") }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/capture-review/commit", () => ({ commitCore: mocks.commitCore, validateCoreProposal: vi.fn() }));
vi.mock("@/lib/capture-review/intake", () => ({ intakeMeta: vi.fn(() => ({})), captureResponse: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/capture-review/record", () => ({
  quickSource: vi.fn(() => "quick"),
  // Runs the commit against the fake transaction below, as a first capture.
  withCaptureReview: vi.fn(async (_meta: unknown, { commit }: { commit: (tx: unknown) => Promise<{ value: unknown }> }) => ({
    value: (await commit({
      list: { findFirst: mocks.listFirst, create: mocks.listCreate },
      project: { findFirst: mocks.projectFirst },
      todo: { update: mocks.todoUpdate },
    })).value,
    created: true,
    reviewId: "review-1",
  })),
}));
import { POST } from "./route";

const LISTS = [
  { id: "todo", name: "To Do", userId: "alice", isDefault: true },
  { id: "garage", name: "Garage", userId: "alice", isDefault: false },
  { id: "later", name: "Later", userId: "alice", isDefault: true },
];
const post = (body: Record<string, unknown>) =>
  POST(new Request("https://example.invalid/api/capture/todo", { method: "POST", body: JSON.stringify(body) }));
const options = () => mocks.commitCore.mock.calls[0][5] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commitCore.mockResolvedValue({ ok: true, id: "todo-1", type: "todo", title: "x", destination: "To Do", path: "/" });
  mocks.listFirst.mockImplementation(async ({ where }: { where: { name?: { equals: string } | string; OR?: Array<{ name: { equals: string } }> } }) => {
    const names = where.OR ? where.OR.map((c) => c.name.equals.toLowerCase()) : [typeof where.name === "string" ? where.name.toLowerCase() : where.name!.equals.toLowerCase()];
    return LISTS.find((l) => names.includes(l.name.toLowerCase())) ?? null;
  });
  mocks.listCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "created", ...data }));
  mocks.projectFirst.mockResolvedValue({ id: "inbox-project" });
});

describe("POST /api/capture/todo", () => {
  it("files a todo with no list into To Do, with the Inbox project", async () => {
    const res = await post({ title: "Call the bank" });
    expect(res.status).toBe(200);
    expect(options()).toEqual({ mode: "web", listId: "todo" });
    expect(mocks.listCreate).not.toHaveBeenCalled();
    expect(mocks.todoUpdate).toHaveBeenCalledWith({ where: { id: "todo-1" }, data: { projectId: "inbox-project" } });
  });

  it("files an explicit list straight there", async () => {
    await post({ title: "Fix the hinge", list: "garage" });
    expect(options()).toEqual({ mode: "web", listId: "garage" });
  });

  it("files an @alias straight into its list", async () => {
    await post({ title: "@garage fix the hinge" });
    expect(options()).toMatchObject({ mode: "web", listId: "garage", projectId: null });
    expect(mocks.commitCore.mock.calls[0][3]).toMatchObject({ title: "fix the hinge" });
  });

  it("creates a missing default list named explicitly", async () => {
    await post({ title: "Keep an eye on it", list: "Monitor" });
    expect(mocks.listCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "Monitor", isDefault: true, userId: "alice", position: 1 }) });
    expect(options()).toEqual({ mode: "web", listId: "created" });
  });

  it("no longer creates an Inbox list", async () => {
    const res = await post({ title: "Sort later", list: "Inbox" });
    expect(res.status).toBe(404);
    expect(mocks.listCreate).not.toHaveBeenCalled();
    expect(mocks.commitCore).not.toHaveBeenCalled();
  });

  it("404s an unknown explicit list", async () => {
    const res = await post({ title: "x", list: "Groceries" });
    expect(res.status).toBe(404);
    expect(mocks.commitCore).not.toHaveBeenCalled();
  });
});
