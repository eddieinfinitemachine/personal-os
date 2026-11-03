import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), claude: vi.fn(), health: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
vi.mock("@/lib/workout-health", async (orig) => ({ ...(await orig<typeof import("@/lib/workout-health")>()), loadHealth: mocks.health }));
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

const health = {
  age: 41, sex: "M", heightIn: null, weight: { value: 182, unit: "lb", at: Date.now() - 86_400_000 }, bodyFat: null, vo2: null,
  hrv: { latest: { value: 40, unit: "ms", at: Date.now() }, baseline: 55 }, rhr: null, conditions: ["Tennis elbow"], activity: [],
};
const text = (call = 0) => mocks.claude.mock.calls[call][0].messages[0].content.at(-1).text as string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.claude.mockResolvedValue(reply);
  mocks.health.mockResolvedValue(null);
});

describe("POST /api/workout/plan", () => {
  it("gives Claude the training log: what not to repeat and the next load", async () => {
    const res = await POST(req({ minutes: "30", focus: "upper", notes: "bodyweight", history: JSON.stringify(history) }));
    expect(res.status).toBe(200);
    expect(text()).toContain("Training log, newest first:\n- ");
    expect(text()).toContain("(yesterday) · Legs · lower · 30 min: Goblet squat");
    expect(text()).toContain("Don't repeat these main exercises from the last session; train the same muscles with different movements unless the equipment leaves no alternative: Goblet squat.");
    expect(text()).toContain(": 10, 10 @ 2×25 lb [target 10] → next 2×30 lb");
    expect(mocks.claude.mock.calls[0][0].system).toContain("skip the exercises it says not to repeat");
  });
  it("works without a log and rejects one that isn't JSON", async () => {
    await POST(req({ notes: "bodyweight" }));
    expect(text()).not.toContain("Training log");
    expect((await POST(req({ notes: "bodyweight", history: "{nope" }))).status).toBe(400);
    expect(mocks.claude).toHaveBeenCalledTimes(1);
  });
  it("reads the health profile: in the prompt, holding loads on a low-recovery day, and back to the client", async () => {
    mocks.health.mockResolvedValue(health);
    const res = await POST(req({ notes: "bodyweight", history: JSON.stringify(history) }));
    expect(mocks.health).toHaveBeenCalledWith("u1", expect.any(Number));
    expect(text()).toContain("Athlete health data, from their health profile:\n- 41-year-old male, 182 lb");
    expect(text()).toContain("- Recovery today is LOW: HRV 40 ms is 27% under your 30-day average (55).");
    expect(text()).toContain("- Conditions to work around: Tennis elbow.");
    expect(text()).toContain("[target 10] → next 2×25 lb");
    const data = (await res.json()) as { health: unknown; fullGym: boolean };
    expect(data.fullGym).toBe(false);
    expect(data.health).toEqual({
      facts: ["182 lb", "HRV 40 ms · avg 55", "1 condition noted"], readiness: "low", note: "HRV 40 ms is 27% under your 30-day average (55).",
    });
  });
  it("plans without health data when the profile can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.health.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ notes: "bodyweight" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { health: unknown }).health).toBeNull();
    expect(text()).not.toContain("health data");
  });
  it("plans for a full gym without photos or saved equipment", async () => {
    mocks.claude.mockResolvedValue({ ...reply, equipment: [{ name: "Power racks & squat racks" }] });
    const res = await POST(req({ fullGym: "1", knownEquipment: JSON.stringify([{ name: "Rusty kettlebell" }]) }));
    expect(res.status).toBe(200);
    expect(text()).toContain("They are in a fully equipped commercial gym. All of this is available: Olympic barbells & plates");
    expect(text()).not.toContain("Rusty kettlebell");
    const data = (await res.json()) as { fullGym: boolean; equipment: { name: string }[] };
    expect(data.fullGym).toBe(true);
    expect(data.equipment.filter((e) => e.name === "Power racks & squat racks")).toHaveLength(1);
    expect(data.equipment).toHaveLength(24);
  });
});
