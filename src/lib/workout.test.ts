import { describe, expect, it } from "vitest";
import {
  FULL_GYM_EQUIPMENT,
  adjustLoad,
  appendBlocks,
  buildExtendPrompt,
  buildUserPrompt,
  estimatePlanMinutes,
  flattenPlan,
  loadStep,
  normalizeExtension,
  normalizePlanResponse,
  parseLoad,
  planExercises,
  upcomingSteps,
  updateExercise,
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
    expect(steps[1].restSec).toBe(0);
    expect(estimatePlanMinutes(plan)).toBeGreaterThan(5);
  });
});

describe("rest pacing", () => {
  const pacedPlan = (type: "straight" | "superset" | "circuit", movements: Array<{ sets: number; restSec: number }>) =>
    normalizePlanResponse({ plan: { blocks: [{ name: "A", type, exercises: movements.map((e, i) => ({ name: `Move ${i + 1}`, reps: 10, ...e })) }] } }).plan;

  it("flows through a circuit and recovers once per round using the longest prescribed rest", () => {
    const p = pacedPlan("circuit", [90, 60, 30, 45].map((restSec) => ({ sets: 3, restSec })));
    expect(flattenPlan(p).map((s) => s.restSec)).toEqual([0, 0, 0, 90, 0, 0, 0, 90, 0, 0, 0, 0]);
    // Twelve 30-second sets plus two 90-second recoveries.
    expect(estimatePlanMinutes(p)).toBe(9);
  });

  it("rests between superset rounds even when later rounds have fewer movements", () => {
    const p = pacedPlan("superset", [{ sets: 3, restSec: 90 }, { sets: 1, restSec: 30 }]);
    const steps = flattenPlan(p);
    expect(steps.map((s) => `${s.exercise.name}:${s.setIndex}`)).toEqual(["Move 1:0", "Move 2:0", "Move 1:1", "Move 1:2"]);
    expect(steps.map((s) => s.restSec)).toEqual([0, 90, 90, 0]);
  });

  it("does not carry a finished movement's longer recovery into later rounds", () => {
    const p = pacedPlan("superset", [{ sets: 3, restSec: 60 }, { sets: 1, restSec: 120 }]);
    expect(flattenPlan(p).map((s) => s.restSec)).toEqual([0, 120, 60, 0]);
  });

  it("keeps prescribed straight-set recovery, including before another strength exercise", () => {
    const p = pacedPlan("straight", [{ sets: 2, restSec: 150 }, { sets: 2, restSec: 90 }]);
    expect(flattenPlan(p).map((s) => s.restSec)).toEqual([150, 150, 90, 0]);
  });

  it("keeps recovery when moving into another main block", () => {
    const p = pacedPlan("circuit", [{ sets: 1, restSec: 90 }, { sets: 1, restSec: 30 }]);
    p.blocks.push(...pacedPlan("straight", [{ sets: 2, restSec: 120 }]).blocks);
    expect(flattenPlan(p).map((s) => s.restSec)).toEqual([0, 90, 120, 0]);
  });

  it("moves straight into cooldown and never inserts rests in warm-up or cooldown", () => {
    const p = pacedPlan("straight", [{ sets: 2, restSec: 120 }]);
    p.warmup = [{ ...p.blocks[0].exercises[0], id: "warmup", sets: 1, restSec: 45 }];
    p.cooldown = ["cooldown-1", "cooldown-2"].map((id) => ({ ...p.warmup[0], id }));
    expect(flattenPlan(p).map((s) => s.restSec)).toEqual([0, 120, 0, 0, 0]);
  });

  it("estimates added circuit time with recovery once per round", () => {
    const p = pacedPlan("straight", [{ sets: 1, restSec: 0 }]);
    p.estimatedMinutes = 1;
    const extra = pacedPlan("circuit", [90, 60, 30, 45].map((restSec) => ({ sets: 3, restSec })));
    // 30 seconds of existing work + 360 seconds added work + 180 seconds recovery.
    expect(appendBlocks(p, extra.blocks).estimatedMinutes).toBe(10);
  });
});

describe("loads", () => {
  it("reads the number and unit out of plain words, and steps it", () => {
    expect(parseLoad("2×25 lb dumbbells")).toEqual({ prefix: "2×", amount: 25, unit: "lb", suffix: " dumbbells" });
    expect(parseLoad("16 kg kettlebell")?.unit).toBe("kg");
    expect(parseLoad("35 lbs")).toMatchObject({ amount: 35, unit: "lb" });
    expect(parseLoad("bodyweight")).toBeNull();
    expect(parseLoad("light band")).toBeNull();
    expect(adjustLoad("2×25 lb dumbbells", 5)).toBe("2×30 lb dumbbells");
    expect(adjustLoad("16 kg kettlebell", -2.5)).toBe("16 kg kettlebell".replace("16", "13.5"));
    expect(adjustLoad("2.5 lb plates", -5)).toBe("0 lb plates");
    expect(adjustLoad("bodyweight", 5)).toBe("bodyweight");
    expect(loadStep("kg")).toBe(2.5);
    expect(loadStep("lb")).toBe(5);
  });
});

describe("changing and extending a plan", () => {
  const plan = normalizePlanResponse(raw).plan;
  it("updateExercise changes one exercise anywhere and keeps the plan when nothing changes", () => {
    const target = plan.blocks[0].exercises[1];
    const next = updateExercise(plan, target.id, { load: "heavy" });
    expect(next.blocks[0].exercises[1].load).toBe("heavy");
    expect(next.blocks[0].exercises[0]).toBe(plan.blocks[0].exercises[0]);
    expect(next.warmup).not.toBe(plan.warmup);
    expect(updateExercise(next, target.id, { load: "heavy" })).toBe(next);
    expect(updateExercise(plan, "missing", { load: "x" })).toBe(plan);
    expect(planExercises(plan).map((e) => e.name)).toEqual(["Arm circles", "DB bench press", "Plank", "Curl", "Child's pose"]);
  });
  it("normalizeExtension takes blocks from Claude's reply with fresh ids, and rejects an empty one", () => {
    const blocks = normalizeExtension({
      blocks: [{ name: "C · Finisher", type: "circuit", exercises: [{ name: "Burpees", pattern: "cardio", sets: 3, durationSec: 40, restSec: 20 }] }],
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].exercises[0]).toMatchObject({ name: "Burpees", sets: 3, durationSec: 40 });
    expect(blocks[0].exercises[0].id).toMatch(/^extra-/);
    expect(normalizeExtension({ plan: { blocks: [{ name: "x", exercises: ["Lunges"] }] } })[0].exercises[0].name).toBe("Lunges");
    expect(() => normalizeExtension({ blocks: [] })).toThrow("no exercises");
    expect(() => normalizeExtension("nope")).toThrow("not an object");
  });
  it("appendBlocks puts the new work before the cool-down and grows the estimate", () => {
    const extra = normalizeExtension({
      blocks: [{ name: "C", type: "straight", exercises: [{ name: "Curl", pattern: "curl", sets: 3, reps: 12, restSec: 60 }] }],
    });
    const next = appendBlocks(plan, extra);
    expect(next.blocks.map((b) => b.name)).toEqual(["A", "B", "C"]);
    expect(next.cooldown).toBe(plan.cooldown);
    expect(next.estimatedMinutes).toBe(18);
    const steps = flattenPlan(next);
    expect(steps.map((s) => s.section).lastIndexOf("main")).toBeLessThan(steps.findIndex((s) => s.section === "cooldown"));
  });
  it("buildExtendPrompt asks for blocks only, on the same equipment, avoiding what was done", () => {
    const prompt = buildExtendPrompt({
      minutes: 20,
      focus: "push",
      intensity: "hard",
      equipment: [{ name: "Dumbbells", detail: "10–50 lb" }, { name: "Bench" }],
      exercises: ["DB bench press", "Plank"],
      notes: "shoulder is sore",
      history: "Training log, newest first:\n- 2026-10-15 (yesterday) · Legs · lower · 30 min: Goblet squat",
      health: "Athlete health data, from their health profile:\n- 41-year-old male",
    });
    expect(prompt).toContain("wants 20 more minutes of work at hard intensity");
    expect(prompt).toContain("Dumbbells (10–50 lb); Bench.");
    expect(prompt).toContain("- DB bench press\n- Plank");
    expect(prompt).toContain("shoulder is sore\nAthlete health data, from their health profile:\n- 41-year-old male\nTraining log, newest first:\n- 2026-10-15 (yesterday)");
    expect(prompt).toContain("No warm-up or cool-down");
    expect(prompt).toContain('{"blocks": [<Block object>, ...]}');
    expect(buildExtendPrompt({ minutes: 10, focus: "core", intensity: "easy", equipment: [], exercises: [], notes: "", history: "", health: "" })).toContain("bodyweight only");
  });
});

describe("upcomingSteps", () => {
  const plan = normalizePlanResponse({
    plan: {
      warmup: [{ name: "Arm circles", durationSec: 30 }],
      blocks: [
        { name: "A", type: "straight", exercises: [{ name: "Squat", sets: 3, reps: 5 }] },
        { name: "B", type: "superset", exercises: [{ name: "Row", sets: 2, reps: 10 }, { name: "Press", sets: 2, reps: 10 }] },
      ],
      cooldown: [{ name: "Stretch", durationSec: 30 }],
    },
  }).plan;
  const steps = flattenPlan(plan);
  const view = (i: number) => upcomingSteps(steps, i).map((g) => `${g.name}(${g.blockType}): ${g.items.map((x) => `${x.exercise.name}×${x.setsLeft}`).join(", ")}`);
  it("lists each exercise still ahead once, with its sets left, grouped by block in order", () => {
    expect(view(0)).toEqual(["A(straight): Squat×3", "B(superset): Row×2, Press×2", "Cool-down(straight): Stretch×1"]);
    expect(view(2)).toEqual(["A(straight): Squat×1", "B(superset): Row×2, Press×2", "Cool-down(straight): Stretch×1"]);
    // Mid-superset: Press comes up before the second Row.
    expect(view(4)).toEqual(["B(superset): Press×2, Row×1", "Cool-down(straight): Stretch×1"]);
    expect(view(steps.length - 1)).toEqual([]);
  });
});

describe("buildUserPrompt", () => {
  const base = { minutes: 45, focus: "push" as const, intensity: "hard" as const, notes: "", knownEquipment: [], fullGym: false, hasPhotos: false, history: "", health: "" };
  it("describes a full gym, then health data, then the training log", () => {
    const prompt = buildUserPrompt({ ...base, knownEquipment: FULL_GYM_EQUIPMENT, fullGym: true, health: "Athlete health data…", history: "Training log…" });
    expect(prompt).toContain("They are in a fully equipped commercial gym. All of this is available: Olympic barbells & plates (up to 400+ lb); Power racks & squat racks;");
    expect(prompt).not.toContain("Confirmed equipment");
    expect(prompt).not.toContain("bodyweight only");
    expect(prompt.endsWith("Athlete health data…\nTraining log…")).toBe(true);
    expect(buildUserPrompt(base)).toContain("assume bodyweight only");
  });
});
