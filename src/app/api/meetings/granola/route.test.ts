import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), founder: vi.fn(), listNotes: vi.fn(), fromEnv: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
vi.mock("@/lib/granola", async (orig) => ({ ...(await orig<typeof import("@/lib/granola")>()), granolaFromEnv: mocks.fromEnv }));
import { GranolaError } from "@/lib/granola";
import { GET } from "./route";

const req = () => new Request("https://example.invalid/api/meetings/granola");
const note = (id: string, created_at: string, title: string | null = id) => ({
  id, title, created_at, updated_at: created_at, owner: { name: "Obie Odom", email: "obie@example.com" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GRANOLA_API_KEY", "synthetic-key");
  mocks.user.mockResolvedValue("founder");
  mocks.founder.mockResolvedValue(true);
  mocks.fromEnv.mockReturnValue({ listNotes: mocks.listNotes });
});

describe("GET /api/meetings/granola", () => {
  it("gates on session, founder and key", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(req())).status).toBe(401);
    mocks.founder.mockResolvedValueOnce(false);
    expect((await GET(req())).status).toBe(403);
    vi.stubEnv("GRANOLA_API_KEY", " ");
    expect((await GET(req())).status).toBe(503);
    expect(mocks.listNotes).not.toHaveBeenCalled();
  });

  it("lists the last 14 days newest first, capped at 30", async () => {
    const notes = Array.from({ length: 35 }, (_, i) =>
      note(`n${i}`, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()),
    );
    notes.push(note("untitled", "2026-09-28T15:00:00Z", null));
    mocks.listNotes.mockResolvedValue(notes);
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.meetings).toHaveLength(30);
    expect(body.meetings[0]).toEqual({
      id: "untitled", title: "Untitled meeting", createdAt: "2026-09-28T15:00:00Z",
      owner: { name: "Obie Odom", email: "obie@example.com" },
    });
    expect(body.meetings[1].id).toBe("n34");
    const since: Date = mocks.listNotes.mock.calls[0][0].createdAfter;
    expect(Date.now() - since.getTime()).toBeGreaterThan(13.9 * 86400_000);
    expect(Date.now() - since.getTime()).toBeLessThan(14.1 * 86400_000);
  });

  it("maps Granola errors to 502 with the message", async () => {
    mocks.listNotes.mockRejectedValue(new GranolaError("Granola rejected GRANOLA_API_KEY (401)", 401));
    const res = await GET(req());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("rejected GRANOLA_API_KEY");
  });
});
