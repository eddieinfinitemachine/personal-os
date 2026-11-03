import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), claude: vi.fn(), health: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
vi.mock("@/lib/workout-health", () => ({ loadHealth: mocks.health }));
import { POST } from "./route";

const photo = (bytes = 10, type = "image/jpeg") => new File([new Uint8Array(bytes)], "board.jpg", { type });
const req = (photos: File[], notes?: string) => {
  const form = new FormData();
  for (const p of photos) form.append("photos", p);
  if (notes) form.set("notes", notes);
  return new Request("https://example.invalid/api/workout/board", { method: "POST", body: form });
};
const reply = { title: "Fran", format: "For time", exercises: [{ name: "Thruster", load: "65 lb", sets: [21, 15, 9] }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.claude.mockResolvedValue(reply);
  mocks.health.mockResolvedValue({ sex: "F" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/workout/board", () => {
  it("reads the board photo into a draft, with Rx for the athlete's sex", async () => {
    const res = await POST(req([photo()], "partner WOD"));
    expect(res.status).toBe(200);
    const { board } = (await res.json()) as { board: { title: string; exercises: { sets: unknown[] }[] } };
    expect(board.title).toBe("Fran");
    expect(board.exercises[0].sets).toHaveLength(3);
    const call = mocks.claude.mock.calls[0][0];
    expect(call.system).toContain("whiteboards");
    expect(call.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
    expect(call.messages[0].content.at(-1).text).toBe("Read the workout on this whiteboard.\nThe athlete is female.\nNotes from the athlete: partner WOD");
  });
  it("says why when there's no workout, and maps Claude failures", async () => {
    mocks.claude.mockResolvedValueOnce({ error: "That's a lunch menu" });
    const none = await POST(req([photo()]));
    expect(none.status).toBe(422);
    expect(await none.json()).toEqual({ error: "No workout found on that board: That's a lunch menu" });
    mocks.claude.mockResolvedValueOnce({ exercises: [] });
    expect(await (await POST(req([photo()]))).json()).toEqual({ error: "No workout found on that board." });
    mocks.claude.mockRejectedValueOnce(new Error("Claude error 529 overloaded"));
    expect((await POST(req([photo()]))).status).toBe(503);
    mocks.claude.mockRejectedValueOnce(new Error("boom"));
    expect((await POST(req([photo()]))).status).toBe(502);
  });
  it("needs 1–3 photos under 6 MB and a signed-in user; reads without a health profile", async () => {
    expect((await POST(req([]))).status).toBe(400);
    expect((await POST(req([photo(), photo(), photo(), photo()]))).status).toBe(400);
    expect((await POST(req([photo(7 * 1024 * 1024)]))).status).toBe(413);
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(req([photo()]))).status).toBe(401);
    expect(mocks.claude).not.toHaveBeenCalled();
    mocks.health.mockRejectedValueOnce(new Error("db down"));
    expect((await POST(req([photo(10, "image/heic")]))).status).toBe(200);
    expect(mocks.claude.mock.calls[0][0].messages[0].content[0].source.media_type).toBe("image/jpeg");
    expect(mocks.claude.mock.calls[0][0].messages[0].content.at(-1).text).toBe("Read the workout on this whiteboard.");
  });
});
