import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), lists: vi.fn(), createMany: vi.fn(), sync: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: mocks.sync }));
vi.mock("@/lib/prisma", () => ({ prisma: { list: { findMany: mocks.lists }, todo: { createMany: mocks.createMany } } }));
vi.mock("@/lib/lists", () => ({
  CAPTURE_LIST_NAME: "To Do",
  ensureDefaultLists: vi.fn(),
  ensureInboxProject: vi.fn().mockResolvedValue("inbox-project"),
}));
import { POST } from "./route";

const req = (body: unknown) =>
  new Request("https://example.invalid/api/meetings/commit", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("founder");
  mocks.lists.mockResolvedValue([
    { id: "todo", name: "To Do", isDefault: true, userId: "founder" },
    { id: "ob", name: "EC/OB", isDefault: false, userId: "founder" },
  ]);
});

describe("POST /api/meetings/commit", () => {
  it("files unrouted items to To Do + Inbox and stamps provenance with the note link", async () => {
    const res = await POST(
      req({
        meetingTitle: "GTM Meeting 9/28",
        meetingDate: "2026-09-28",
        sourceUrl: "https://notes.granola.ai/d/note-1",
        items: [
          { title: "Automate no-show texts", notes: "Keep states consistent", listId: "ob", dueDate: "2026-10-01" },
          { title: "Design the $5 ad", listId: null },
          { title: "Ghost list", listId: "someone-elses" },
          { title: "   " },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const { data } = mocks.createMany.mock.calls[0][0];
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({
      listId: "ob", projectId: null, dueDate: new Date("2026-10-01"),
      notes: "Keep states consistent\nFrom meeting: GTM Meeting 9/28 (2026-09-28)\nhttps://notes.granola.ai/d/note-1",
    });
    expect(data[1]).toMatchObject({ listId: "todo", projectId: "inbox-project" });
    expect(data[1].notes).toBe("From meeting: GTM Meeting 9/28 (2026-09-28)\nhttps://notes.granola.ai/d/note-1");
    expect(data[2]).toMatchObject({ listId: "todo", projectId: "inbox-project" });
    expect(await res.json()).toEqual({
      created: 3,
      byList: [
        { listId: "ob", listName: "EC/OB", count: 1 },
        { listId: "todo", listName: "To Do", count: 2 },
      ],
    });
  });

  it("drops non-http source links and rejects empty or unauthenticated requests", async () => {
    await POST(req({ meetingTitle: "M", sourceUrl: "javascript:alert(1)", items: [{ title: "x" }] }));
    expect(mocks.createMany.mock.calls[0][0].data[0].notes).toBe("From meeting: M");
    expect((await POST(req({ items: [] }))).status).toBe(400);
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(req({ items: [{ title: "x" }] }))).status).toBe(401);
  });
});
