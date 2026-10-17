import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), claude: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
import { POST } from "./route";

const reply = { equipment: [], plan: { title: "Upper", blocks: [{ name: "A", exercises: [{ name: "Push-up", pattern: "push-horizontal", sets: 3, reps: 12 }] }] } };
const req = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("https://example.invalid/api/workout/plan", { method: "POST", body: form });
};
const finishedAt = Date.now() - 86_400_000;
const history = [{ id: "w-1", title: "Legs", focus: "lower", startedAt: finishedAt - 1800000, finishedAt, durationMin: 30, exercises: [
  { name: "Goblet squat", equipment: "dumbbell", targetReps: 10, sets: [{ reps: 10, load: "2×25 lb" }, { reps: 10, load: "2×25 lb" }] },
] }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.claude.mockResolvedValue(reply);
});

describe("POST /api/workout/plan", () => {
  it("gives Claude the training log: what not to repeat and the next load", async () => {
    const res = await POST(req({ minutes: "30", focus: "upper", notes: "bodyweight", history: JSON.stringify(history) }));
    expect(res.status).toBe(200);
    const text = mocks.claude.mock.calls[0][0].messages[0].content.at(-1).text as string;
    expect(text).toContain("Training log, newest first:\n- ");
    expect(text).toContain("(yesterday) · Legs · lower · 30 min: Goblet squat");
    expect(text).toContain("Don't repeat these main exercises from the last session; train the same muscles with different movements unless the equipment leaves no alternative: Goblet squat.");
    expect(text).toContain(": 10, 10 @ 2×25 lb [target 10] → next 2×30 lb");
    expect(mocks.claude.mock.calls[0][0].system).toContain("skip the exercises it says not to repeat");
  });
  it("works without a log and rejects one that isn't JSON", async () => {
    await POST(req({ notes: "bodyweight" }));
    expect(mocks.claude.mock.calls[0][0].messages[0].content.at(-1).text).not.toContain("Training log");
    expect((await POST(req({ notes: "bodyweight", history: "{nope" }))).status).toBe(400);
    expect(mocks.claude).toHaveBeenCalledTimes(1);
  });
});
