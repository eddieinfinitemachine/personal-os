import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), claude: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
import { POST } from "./route";

const req = (body: unknown) =>
  new Request("https://example.invalid/api/workout/extend", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const reply = { blocks: [{ name: "C · Finisher", type: "circuit", exercises: [{ name: "Burpees", pattern: "cardio", sets: 3, durationSec: 40, restSec: 20 }] }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.claude.mockResolvedValue(reply);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/workout/extend", () => {
  it("asks Claude for more blocks on the session's equipment, avoiding what was done", async () => {
    const res = await POST(
      req({ minutes: 20, focus: "push", intensity: "hard", equipment: [{ name: " Dumbbells ", detail: "10–50 lb" }, { name: "" }, 3], exercises: ["DB bench press", " ", 4], notes: "x",
        history: [{ id: "w-1", title: "Push", focus: "push", finishedAt: Date.now() - 2 * 86_400_000, exercises: [{ name: "Arnold press", targetReps: 10, sets: [{ reps: 10, load: "2×25 lb" }] }] }] }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { blocks: { name: string; exercises: { id: string; name: string }[] }[] };
    expect(data.blocks[0].name).toBe("C · Finisher");
    expect(data.blocks[0].exercises[0]).toMatchObject({ name: "Burpees" });
    const prompt = mocks.claude.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("wants 20 more minutes of work at hard intensity");
    expect(prompt).toContain("Dumbbells (10–50 lb).");
    expect(prompt).toContain("- DB bench press");
    expect(prompt).not.toContain("- 4");
    expect(prompt).toContain("(2 days ago) · Push · push");
    expect(prompt).toContain("- Arnold press · ");
  });
  it("rejects other lengths, bad JSON and signed-out callers, and reports a failed build", async () => {
    expect((await POST(req({ minutes: 15 }))).status).toBe(400);
    expect((await POST(req("{nope"))).status).toBe(400);
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(req({ minutes: 10 }))).status).toBe(401);
    expect(mocks.claude).not.toHaveBeenCalled();
    mocks.claude.mockResolvedValueOnce({ blocks: [] });
    expect((await POST(req({ minutes: 10 }))).status).toBe(502);
    mocks.claude.mockRejectedValueOnce(new Error("Claude error 529 overloaded"));
    expect((await POST(req({ minutes: 30 }))).status).toBe(503);
  });
});
