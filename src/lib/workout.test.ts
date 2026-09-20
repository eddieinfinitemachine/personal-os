import { describe, expect, it } from "vitest";
import {
  estimatePlanMinutes,
  flattenPlan,
  normalizePlanResponse,
  type WorkoutPlan,
} from "./workout";

const raw = {
  equipment: [{ name: "Dumbbells", detail: "10–50 lb" }, "Bench", { name: "" }, 42],
  plan: {
    title: "Push day",
    summary: "Chest and shoulders.",
    focus: "push",
    estimatedMinutes: "35",
    warmup: [{ name: "Arm circles", pattern: "stretch", durationSec: 30, sets: 3, restSec: 45 }],
    blocks: [
      {
        name: "A",
        type: "superset",
        exercises: [
          {
            name: "DB bench press",
            pattern: "push-horizontal",
            sets: 3,
            reps: 8,
            restSec: 90,
            load: "2×40 lb",
            cues: ["Tuck elbows"],
            muscles: ["chest", "triceps", "not-a-muscle"],
          },
          {
            name: "Plank",
            pattern: "plank",
            sets: 2,
            reps: 10,
            durationSec: 45,
            restSec: 30,
            muscles: ["core"],
          },
        ],
      },
      { name: "empty", type: "straight", exercises: [] },
      { name: "B", type: "weird", exercises: [{ name: "Curl", pattern: "nope", sets: 99 }] },
    ],
    cooldown: ["Child's pose", "  ", 7],
  },
};

describe("normalizePlanResponse", () => {
  it("coerces a loose Claude reply into a strict plan", () => {
    const out = normalizePlanResponse(raw);
    expect(out.equipment).toEqual([{ name: "Dumbbells", detail: "10–50 lb" }, { name: "Bench" }]);
    expect(out.plan.estimatedMinutes).toBe(35);
    expect(out.plan.focus).toBe("push");
    // warm-up items are forced to one set, no rest
    expect(out.plan.warmup[0]).toMatchObject({ sets: 1, restSec: 0, durationSec: 30, reps: null });
    // bare strings become 30 s timed movements
    expect(out.plan.cooldown).toHaveLength(1);
    expect(out.plan.cooldown[0]).toMatchObject({ name: "Child's pose", pattern: "stretch", durationSec: 30, sets: 1 });
    expect(out.plan.blocks).toHaveLength(2);
    const [a, b] = out.plan.blocks;
    expect(a.type).toBe("superset");
    expect(a.exercises[0].muscles).toEqual(["chest", "triceps"]);
    // both reps and durationSec given: plank keeps the timed form
    expect(a.exercises[1]).toMatchObject({ reps: null, durationSec: 45 });
    expect(b.type).toBe("straight");
    expect(b.exercises[0]).toMatchObject({ pattern: "stretch", sets: 12, reps: 10, load: "bodyweight" });
  });

  it("rejects a plan with no exercises", () => {
    expect(() => normalizePlanResponse({ plan: { blocks: [] } })).toThrow(/no exercises/);
  });
});

describe("flattenPlan", () => {
  it("interleaves supersets and finishes with zero rest", () => {
    const plan: WorkoutPlan = normalizePlanResponse(raw).plan;
    const steps = flattenPlan(plan);
    const names = steps.map((s) => `${s.exercise.name}#${s.setIndex}`);
    expect(names).toEqual([
      "Arm circles#0",
      "DB bench press#0",
      "Plank#0",
      "DB bench press#1",
      "Plank#1",
      "DB bench press#2",
      "Curl#0",
      "Curl#1",
      "Curl#2",
      "Curl#3",
      "Curl#4",
      "Curl#5",
      "Curl#6",
      "Curl#7",
      "Curl#8",
      "Curl#9",
      "Curl#10",
      "Curl#11",
      "Child's pose#0",
    ]);
    expect(steps[steps.length - 1].restSec).toBe(0);
    expect(steps[1].restSec).toBe(90);
    expect(estimatePlanMinutes(plan)).toBeGreaterThan(5);
  });
});
