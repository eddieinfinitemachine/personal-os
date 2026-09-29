import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findTodo: vi.fn(),
  parse: vi.fn(),
  createAsset: vi.fn(),
  deleteTodo: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { todo: { findFirst: mocks.findTodo } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/smart-capture", () => ({ parseCapture: mocks.parse }));
vi.mock("@/lib/smart-commit", () => ({ createAssetFromProposal: mocks.createAsset }));
vi.mock("@/lib/todo-delete", () => ({ deleteTodo: mocks.deleteTodo }));
import { POST } from "./route";
import { todoCaptureText } from "@/lib/asset-trackers";

const req = (body: unknown) =>
  new Request("https://example.invalid/api/todos/t1/to-tracker", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "t1" }) };

const created = new Date("2026-09-01T10:00:00Z");
const todoRow = {
  id: "t1",
  title: "Watch: 711 documentary",
  notes: "Maya recommended\nFrom meeting: GTM 9/28 (2026-09-28)\nhttps://notes.granola.ai/d/n1",
  dueDate: null,
  completedAt: null,
  listId: "later",
  projectId: "p1",
  parentId: null,
  position: 3,
  createdAt: created,
  droppedAt: null,
  isReference: false,
  snoozedUntil: null,
  subtasks: [
    { id: "s1", title: "find a stream", notes: null, dueDate: null, completedAt: null, position: 0 },
  ],
};
const proposal = {
  type: "asset",
  assetKind: "media",
  title: " 711 ",
  subtitle: "Director Name",
  category: "documentary",
  status: "to-watch",
  projectId: "hallucinated",
  details: { releaseYear: 2024 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("founder");
  mocks.findTodo.mockResolvedValue(todoRow);
  mocks.parse.mockResolvedValue(proposal);
  mocks.createAsset.mockResolvedValue({
    id: "a1",
    kind: "media",
    title: "711",
    subtitle: "Director Name",
    category: "documentary",
    status: "to-watch",
    notes: "internal",
  });
  mocks.deleteTodo.mockResolvedValue(undefined);
});

describe("POST /api/todos/[id]/to-tracker", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(req({ kind: "media" }), ctx)).status).toBe(401);
    expect(mocks.findTodo).not.toHaveBeenCalled();
  });

  it("400s on a missing or unknown kind", async () => {
    for (const body of [{}, { kind: "trip" }, { kind: "media " }, "not json"]) {
      expect((await POST(req(body), ctx)).status).toBe(400);
    }
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("404s when the todo isn't on a list the user can access", async () => {
    mocks.findTodo.mockResolvedValueOnce(null);
    expect((await POST(req({ kind: "media" }), ctx)).status).toBe(404);
    const where = mocks.findTodo.mock.calls[0][0].where;
    expect(where.id).toBe("t1");
    expect(where.list).toEqual({ OR: [{ userId: "founder" }, { members: { some: { userId: "founder" } } }] });
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("502s and keeps the todo when Claude fails or returns the wrong kind", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.parse.mockRejectedValueOnce(new Error("Claude error (500): boom"));
    expect((await POST(req({ kind: "media" }), ctx)).status).toBe(502);
    mocks.parse.mockResolvedValueOnce({ type: "todo", title: "x" });
    expect((await POST(req({ kind: "media" }), ctx)).status).toBe(502);
    mocks.parse.mockResolvedValueOnce({ ...proposal, assetKind: "place" });
    expect((await POST(req({ kind: "media" }), ctx)).status).toBe(502);
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.deleteTodo).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("files the asset, deletes the todo and returns the restore snapshot", async () => {
    const res = await POST(req({ kind: "media" }), ctx);
    expect(res.status).toBe(200);

    expect(mocks.parse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Watch: 711 documentary\nMaya recommended",
        forceType: "media",
        activeProjects: [],
      }),
    );
    expect(mocks.createAsset).toHaveBeenCalledWith(
      "founder",
      expect.objectContaining({ assetKind: "media", title: "711", projectId: null }),
      { source: "todo", sourceTodoId: "t1", sourceTodoTitle: "Watch: 711 documentary" },
    );
    expect(mocks.deleteTodo).toHaveBeenCalledWith("t1");

    expect(await res.json()).toEqual({
      asset: {
        id: "a1",
        kind: "media",
        title: "711",
        subtitle: "Director Name",
        category: "documentary",
        status: "to-watch",
      },
      todo: {
        id: "t1",
        title: "Watch: 711 documentary",
        notes: todoRow.notes,
        dueDate: null,
        completedAt: null,
        listId: "later",
        projectId: "p1",
        parentId: null,
        position: 3,
        createdAt: created.toISOString(),
        droppedAt: null,
        isReference: false,
        snoozedUntil: null,
        subtasks: [
          { id: "s1", title: "find a stream", notes: null, dueDate: null, completedAt: null, position: 0 },
        ],
      },
      trackerRoute: "/media",
    });
  });

  it("routes each kind to its tracker page", async () => {
    for (const [kind, route] of [
      ["place", "/places"],
      ["inventory", "/inventory"],
      ["investment", "/investments"],
      ["practice", "/best-practices"],
    ]) {
      mocks.parse.mockResolvedValueOnce({ ...proposal, assetKind: kind });
      const res = await POST(req({ kind }), ctx);
      expect((await res.json()).trackerRoute).toBe(route);
    }
  });
});

describe("todoCaptureText", () => {
  it("is the title alone without notes", () => {
    expect(todoCaptureText(" Watch: 711 ", null)).toBe("Watch: 711");
  });
  it("drops meeting provenance but keeps other notes and links", () => {
    expect(
      todoCaptureText(
        "Try Lucali",
        "pizza in Carroll Gardens\nhttps://lucali.com\nFrom meeting: Dinner (2026-09-01)\nhttps://notes.granola.ai/d/x",
      ),
    ).toBe("Try Lucali\npizza in Carroll Gardens\nhttps://lucali.com");
  });
});
