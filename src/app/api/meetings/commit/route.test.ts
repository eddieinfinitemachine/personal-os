import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), commit: vi.fn(), after: vi.fn(), sync: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: mocks.sync }));
vi.mock("@/lib/meeting-import", () => ({ commitItems: mocks.commit }));
import { POST } from "./route";

// Row building (list fallback, Inbox, provenance, autopilotKey, GranolaImport)
// is covered in src/lib/meeting-import.test.ts; this covers the route's own job.

const req = (body: unknown) =>
  new Request("https://example.invalid/api/meetings/commit", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("founder");
  mocks.commit.mockResolvedValue({ created: 2, byList: [{ listId: "ob", listName: "EC/OB", count: 2 }] });
});

describe("POST /api/meetings/commit", () => {
  it("commits the reviewed items as a manual import of the note, then syncs the calendar", async () => {
    const res = await POST(
      req({
        noteId: "not_Zh3xFsvZIANAtk",
        meetingTitle: " GTM Meeting 9/28 ",
        meetingDate: "2026-09-28",
        sourceUrl: "https://notes.granola.ai/d/note-1",
        items: [{ title: " Automate no-show texts ", listId: "ob" }, { title: "   " }, { title: "Design the $5 ad" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 2, byList: [{ listId: "ob", listName: "EC/OB", count: 2 }] });
    expect(mocks.commit).toHaveBeenCalledWith({
      userId: "founder",
      items: [{ title: "Automate no-show texts", listId: "ob" }, { title: "Design the $5 ad" }],
      meetingTitle: "GTM Meeting 9/28",
      meetingDate: "2026-09-28",
      sourceUrl: "https://notes.granola.ai/d/note-1",
      noteId: "not_Zh3xFsvZIANAtk",
      source: "manual",
    });
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("ignores a malformed noteId rather than recording it", async () => {
    await POST(req({ noteId: "../../x", items: [{ title: "x" }] }));
    expect(mocks.commit.mock.calls[0][0].noteId).toBeNull();
    await POST(req({ items: [{ title: "x" }] }));
    expect(mocks.commit.mock.calls[1][0].noteId).toBeNull();
  });

  it("rejects empty, oversized or unauthenticated requests", async () => {
    expect((await POST(req({ items: [] }))).status).toBe(400);
    expect((await POST(req({ items: Array.from({ length: 101 }, () => ({ title: "x" })) }))).status).toBe(400);
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(req({ items: [{ title: "x" }] }))).status).toBe(401);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("reports a missing To Do list as a 500", async () => {
    mocks.commit.mockRejectedValueOnce(new Error("default To Do list missing"));
    const res = await POST(req({ items: [{ title: "x" }] }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("default To Do list missing");
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
