import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(), founder: vi.fn(), getNote: vi.fn(), fromEnv: vi.fn(), claude: vi.fn(), lists: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
vi.mock("@/lib/prisma", () => ({ prisma: { list: { findMany: mocks.lists } } }));
vi.mock("@/lib/granola", async (orig) => ({ ...(await orig<typeof import("@/lib/granola")>()), granolaFromEnv: mocks.fromEnv }));
import { GranolaError } from "@/lib/granola";
import { POST } from "./route";

const req = (body: unknown) =>
  new Request("https://example.invalid/api/meetings/granola/parse", { method: "POST", body: JSON.stringify(body) });

const NOTE = {
  id: "note-1", title: null, created_at: "2026-09-28T20:00:00Z", updated_at: "2026-09-28T21:00:00Z",
  owner: { name: "Obie Odom", email: "obie@example.com" },
  web_url: "https://notes.granola.ai/d/note-1",
  calendar_event: { event_title: "GTM Meeting 9/28", scheduled_start_time: "2026-09-28T14:00:00Z" },
  attendees: [{ name: "Obie Odom", email: "obie@example.com" }, { name: null, email: "dave@example.com" }],
  summary_text: "", summary_markdown: "# Next Steps\n- **Deposit backlog cleanup** (Dave)",
  private_notes_text: null, private_notes_markdown: null,
  transcript: [{ speaker: { source: "speaker", name: "Obi" }, text: "I'll automate the no-show texts." }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GRANOLA_API_KEY", "synthetic-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic");
  mocks.user.mockResolvedValue("founder");
  mocks.founder.mockResolvedValue(true);
  mocks.fromEnv.mockReturnValue({ getNote: mocks.getNote });
  mocks.getNote.mockResolvedValue(NOTE);
  mocks.lists.mockResolvedValue([
    { id: "todo", name: "To Do", isDefault: true, userId: "founder" },
    { id: "dv", name: "EC/DV", isDefault: false, userId: "founder" },
    { id: "ob", name: "EC/OB", isDefault: false, userId: "founder" },
  ]);
  mocks.claude.mockResolvedValue({
    items: [
      { title: "Automate no-show follow-up texts", owner: "Obi", listName: "EC/OB" },
      { title: "Deposit backlog cleanup pass", owner: "Dave", listName: null, notes: "A week to close or delete" },
      { title: "Design the $5 come-to-you ad", owner: null, listName: null },
    ],
  });
});

describe("POST /api/meetings/granola/parse", () => {
  it("gates on session, founder, key and noteId", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(req({ noteId: "x" }))).status).toBe(401);
    mocks.founder.mockResolvedValueOnce(false);
    expect((await POST(req({ noteId: "x" }))).status).toBe(403);
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ noteId: "x".repeat(121) }))).status).toBe(400);
    vi.stubEnv("GRANOLA_API_KEY", "");
    expect((await POST(req({ noteId: "x" }))).status).toBe(503);
    expect(mocks.getNote).not.toHaveBeenCalled();
  });

  it("extracts routed items from the note without writing", async () => {
    const res = await POST(req({ noteId: "note-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mocks.getNote).toHaveBeenCalledWith("note-1", { transcript: true });
    expect(body).toMatchObject({
      meetingTitle: "GTM Meeting 9/28",
      meetingDate: "2026-09-28",
      webUrl: "https://notes.granola.ai/d/note-1",
    });
    expect(body.items.map((i: { listName: string | null }) => i.listName)).toEqual(["EC/OB", "EC/DV", null]);
    expect(body.lists).toEqual([{ id: "dv", name: "EC/DV" }, { id: "ob", name: "EC/OB" }]);

    const call = mocks.claude.mock.calls[0][0];
    expect(call.maxTokens).toBe(4000);
    expect(call.system).toContain(`"EC/DV" — Dave (David Vollbach), sales`);
    expect(call.user).toContain("Meeting: GTM Meeting 9/28");
    expect(call.user).toContain("Attendees: Obie Odom, dave@example.com");
    expect(call.user).toContain("Deposit backlog cleanup");
    expect(call.user).toContain("Obi: I'll automate the no-show texts.");
  });

  it("maps Granola and model failures to 502", async () => {
    mocks.getNote.mockRejectedValueOnce(new GranolaError("Granola 404 on /notes/x", 404));
    const a = await POST(req({ noteId: "x" }));
    expect(a.status).toBe(502);
    expect((await a.json()).error).toContain("404");

    mocks.claude.mockRejectedValueOnce(new Error("model did not return JSON"));
    expect((await POST(req({ noteId: "note-1" }))).status).toBe(502);
  });
});
