import { describe, expect, it } from "vitest";
import {
  adviseLoad,
  formatSets,
  historyPrompt,
  lastPerformance,
  mergeHistory,
  normalizeRecords,
  recordFromSession,
  withHistory,
  type ExerciseRecord,
  type HistoryEntry,
  type WorkoutRecord,
} from "./workout-history";
import type { Block, Exercise, WorkoutSession } from "./workout";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 17, 18);

const ex = (name: string, sets: [number | null, string][], targetReps: number | null = 10, equipment = "dumbbell"): ExerciseRecord => ({
  name,
  equipment,
  targetReps,
  sets: sets.map(([reps, load]) => ({ reps, durationSec: reps === null ? 40 : null, load })),
});
const record = (id: string, daysAgo: number, exercises: ExerciseRecord[], title = `Session ${id}`): WorkoutRecord => ({
  id,
  title,
  focus: "full-body",
  startedAt: NOW - daysAgo * DAY - 40 * 60000,
  finishedAt: NOW - daysAgo * DAY,
  durationMin: 40,
  exercises,
});
const exercise = (id: string, name: string, extra: Partial<Exercise> = {}): Exercise => ({
  id, name, pattern: "squat", equipment: "dumbbell", sets: 3, reps: 10, durationSec: null, restSec: 60, load: "2×20 lb dumbbells", cues: [], muscles: [], perSide: false, ...extra,
});

describe("adviseLoad", () => {
  it("goes up a step after every rep, stays when a rep or two short, drops when far off", () => {
    expect(adviseLoad(ex("Goblet squat", [[10, "2×25 lb dumbbells"], [10, "2×25 lb dumbbells"], [10, "2×25 lb dumbbells"]]), null)).toEqual({
      load: "2×30 lb dumbbells", direction: "up", reason: "+5 lb: every rep at 25 lb",
    });
    expect(adviseLoad(ex("Goblet squat", [[10, "25 lb"], [9, "25 lb"], [8, "25 lb"]]), 10)).toMatchObject({ load: "25 lb", direction: "same" });
    expect(adviseLoad(ex("Goblet squat", [[7, "25 lb"], [6, "25 lb"]]), 10)).toEqual({
      load: "20 lb", direction: "down", reason: "−5 lb: reps fell short at 25 lb",
    });
    expect(adviseLoad(ex("Row", [[8, "20 kg"], [8, "20 kg"]], 8), 8)).toMatchObject({ load: "22.5 kg", direction: "up" });
  });
  it("judges the weight the athlete ended on, not the earlier sets", () => {
    // Moved up mid-exercise and got 9 at the new weight: stay there.
    expect(adviseLoad(ex("Press", [[10, "2×25 lb"], [9, "2×30 lb"], [10, "2×30 lb"]]), null)).toMatchObject({ load: "2×30 lb", direction: "same" });
  });
  it("converts across a rep target more than 2 away through an estimated 1RM", () => {
    // 10 at 25 lb ≈ 33 lb 1RM → 27.8 lb for 6 → 30 lb on 5 lb steps.
    expect(adviseLoad(ex("Goblet squat", [[10, "25 lb"]]), 6)).toEqual({ load: "30 lb", direction: "up", reason: "Matched to 6 reps from 10 at 25 lb" });
    expect(adviseLoad(ex("Goblet squat", [[6, "40 lb"]], 6), 15)).toMatchObject({ load: "30 lb", direction: "down" });
  });
  it("holds the weight on a low-recovery day instead of going up", () => {
    const allHit = ex("Goblet squat", [[10, "2×25 lb dumbbells"], [10, "2×25 lb dumbbells"]]);
    expect(adviseLoad(allHit, null, "low")).toEqual({ load: "2×25 lb dumbbells", direction: "same", reason: "Recovery is low today: holding 25 lb" });
    expect(adviseLoad(allHit, null, "normal")).toMatchObject({ load: "2×30 lb dumbbells", direction: "up" });
    expect(adviseLoad(ex("Goblet squat", [[10, "25 lb"]]), 6, "low")).toMatchObject({ load: "25 lb", direction: "same" });
    expect(adviseLoad(ex("Goblet squat", [[7, "25 lb"], [6, "25 lb"]]), 10, "low")).toMatchObject({ load: "20 lb", direction: "down" });
    expect(historyPrompt([record("a", 2, [allHit])], NOW, "low")).toContain("[target 10] → next 2×25 lb dumbbells");
    const [b] = withHistory([{ name: "A", type: "straight", exercises: [exercise("e1", "Goblet squat")] }], [record("a", 2, [allHit])], "low");
    expect(b.exercises[0]).toMatchObject({ load: "2×25 lb dumbbells", last: { advice: { direction: "same" } } });
  });
  it("has nothing to move for bodyweight, timed work or a missing target", () => {
    expect(adviseLoad(ex("Push-up", [[12, "bodyweight"]]), null)).toBeNull();
    expect(adviseLoad(ex("Farmer carry", [[null, "2×50 lb"]], null), null)).toBeNull();
    expect(adviseLoad(ex("Goblet squat", [[10, "25 lb"]], null), null)).toBeNull();
  });
});

describe("recordFromSession", () => {
  it("keeps the main work set by set, in order, and leaves out warm-up, cool-down and skipped exercises", () => {
    const squat = exercise("m1", "Goblet squat");
    const row = exercise("m2", "Row");
    const s: WorkoutSession = {
      id: "w-1",
      plan: {
        title: "Legs", summary: "", focus: "lower", estimatedMinutes: 30,
        warmup: [exercise("w1", "Arm circles", { reps: null, durationSec: 30 })],
        blocks: [{ name: "A", type: "straight", exercises: [squat, row] }],
        cooldown: [exercise("c1", "Stretch", { reps: null, durationSec: 30 })],
      },
      equipment: [],
      startedAt: NOW - 30 * 60000,
      finishedAt: null,
      stepIndex: 0,
      logs: [
        { stepKey: "w1:0", exerciseId: "w1", exerciseName: "Arm circles", setIndex: 0, reps: null, durationSec: 30, load: "bodyweight", completedAt: 0 },
        { stepKey: "m1:1", exerciseId: "m1", exerciseName: "Goblet squat", setIndex: 1, reps: 9, durationSec: null, load: "2×30 lb", completedAt: 0 },
        { stepKey: "m1:0", exerciseId: "m1", exerciseName: "Goblet squat", setIndex: 0, reps: 10, durationSec: null, load: "2×25 lb", completedAt: 0 },
      ],
      timerEndsAt: null, timerKind: null, timerPausedRemainingMs: null,
    };
    expect(recordFromSession(s, NOW)).toEqual({
      id: "w-1", source: "guided", title: "Legs", focus: "lower", startedAt: NOW - 30 * 60000, finishedAt: NOW, durationMin: 30,
      exercises: [{ name: "Goblet squat", equipment: "dumbbell", targetReps: 10, sets: [{ reps: 10, durationSec: null, load: "2×25 lb" }, { reps: 9, durationSec: null, load: "2×30 lb" }] }],
    });
  });
});

describe("formatSets", () => {
  it("groups sets by load and leaves bodyweight bare", () => {
    expect(formatSets(ex("x", [[10, "2×25 lb"], [10, "2×25 lb"], [8, "2×30 lb"]]).sets)).toBe("10, 10 @ 2×25 lb; 8 @ 2×30 lb");
    expect(formatSets(ex("x", [[12, "bodyweight"], [10, "bodyweight"]]).sets)).toBe("12, 10");
    expect(formatSets(ex("x", [[null, "2×50 lb"]]).sets)).toBe("40s @ 2×50 lb");
  });
});

describe("withHistory", () => {
  const log = [
    record("a", 1, [ex("Goblet Squat", [[10, "2×25 lb dumbbells"], [10, "2×25 lb dumbbells"]])]),
    record("b", 8, [ex("Goblet squat", [[10, "2×20 lb dumbbells"]]), ex("Kettlebell swing", [[15, "1×35 lb kettlebell"]], 15, "kettlebell")]),
  ];
  it("uses the latest performance by name and replaces the planned load with the advice", () => {
    expect(lastPerformance(log, "goblet squat (heels up)")?.at).toBe(NOW - DAY);
    const [b] = withHistory([{ name: "A", type: "straight", exercises: [exercise("e1", "Goblet squat")] }], log);
    expect(b.exercises[0].load).toBe("2×30 lb dumbbells");
    expect(b.exercises[0].last).toEqual({
      at: NOW - DAY,
      sets: log[0].exercises[0].sets,
      advice: { load: "2×30 lb dumbbells", direction: "up", reason: "+5 lb: every rep at 25 lb" },
    });
  });
  it("shows last time but keeps the plan's load on other equipment, units, bodyweight or timed work", () => {
    const blocks: Block[] = [{
      name: "A", type: "circuit", exercises: [
        exercise("e1", "Goblet squat", { equipment: "kettlebell", load: "1×35 lb kettlebell" }),
        exercise("e2", "Kettlebell swing", { equipment: "kettlebells", load: "20 kg" }),
        exercise("e3", "Goblet squat", { equipment: "Adjustable dumbbells", load: "bodyweight" }),
        exercise("e4", "Goblet squat", { durationSec: 40, reps: null }),
        exercise("e5", "Plank"),
      ],
    }];
    const out = withHistory(blocks, log)[0].exercises;
    expect(out.map((e) => e.load)).toEqual(["1×35 lb kettlebell", "20 kg", "bodyweight", "2×20 lb dumbbells", "2×20 lb dumbbells"]);
    expect(out.map((e) => e.last?.advice ?? null)).toEqual([null, null, null, null, null]);
    expect(out[0].last?.at).toBe(NOW - DAY);
    expect(out[4].last).toBeUndefined();
    // "Adjustable dumbbells" is still dumbbells.
    expect(withHistory([{ ...blocks[0], exercises: [exercise("e6", "Goblet squat", { equipment: "Adjustable dumbbells" })] }], log)[0].exercises[0].load).toBe("2×30 lb dumbbells");
    expect(withHistory(blocks, [])).toBe(blocks);
  });
});

describe("historyPrompt", () => {
  it("lists sessions, the exercises not to repeat, and the next load for everything logged", () => {
    const prompt = historyPrompt(
      [
        record("old", 9, [ex("Romanian deadlift", [[8, "2×40 lb"], [8, "2×40 lb"]], 8), ex("Goblet squat", [[10, "2×20 lb"]])]),
        record("a", 0, [ex("Push-up", [[15, "bodyweight"], [12, "bodyweight"]], 12, "bodyweight")], "Upper"),
        record("b", 1, [ex("Goblet squat", [[10, "2×25 lb"], [9, "2×25 lb"]])], "Legs"),
        record("c", 3, [], "Mobility"),
        record("d", 5, [ex("DB row", [[10, "1×40 lb"]])]),
      ],
      NOW,
    );
    expect(prompt).toBe(
      [
        "Training log, newest first:",
        "- 2026-10-17 (today) · Upper · full-body · 40 min: Push-up",
        "- 2026-10-16 (yesterday) · Legs · full-body · 40 min: Goblet squat",
        "- 2026-10-14 (3 days ago) · Mobility · full-body · 40 min",
        "- 2026-10-12 (5 days ago) · Session d · full-body · 40 min: DB row",
        "- 2026-10-08 (9 days ago) · Session old · full-body · 40 min: Romanian deadlift, Goblet squat",
        // Sessions with nothing logged (Mobility) don't count toward the last 3.
        "Don't repeat these main exercises from the last 3 sessions; train the same muscles with different movements unless the equipment leaves no alternative: Push-up, Goblet squat, DB row.",
        "Last performance per exercise [target reps] and the load to use next if you program it. Keep its exact name:",
        "- Push-up · 2026-10-17: 15, 12 [target 12]",
        "- Goblet squat · 2026-10-16: 10, 9 @ 2×25 lb [target 10] → next 2×25 lb",
        "- DB row · 2026-10-12: 10 @ 1×40 lb [target 10] → next 1×45 lb",
        "- Romanian deadlift · 2026-10-08: 8, 8 @ 2×40 lb [target 8] → next 2×45 lb",
      ].join("\n"),
    );
    expect(historyPrompt([], NOW)).toBe("");
  });
});

describe("normalizeRecords", () => {
  it("coerces what the device or the database sends, newest first and one per id", () => {
    const out = normalizeRecords(
      [
        { id: "w-1", title: " Legs ", focus: "lower", startedAt: NOW - DAY - 1800000, finishedAt: NOW - DAY, durationMin: 30, exercises: [
          { name: " Goblet squat ", equipment: "", targetReps: "10", sets: [{ reps: 10, load: "2×25 lb" }, { reps: "x" }, { durationSec: 40 }, 3] },
          { name: "", sets: [{ reps: 5 }] },
          { name: "Nothing logged", sets: [] },
        ] },
        { id: "w-1", finishedAt: NOW - 2 * DAY },
        { id: "w-2", focus: "nope", finishedAt: NOW, exercises: "x" },
        { id: "", finishedAt: NOW },
        { id: "w-3", finishedAt: "yesterday" },
        { id: "w-4", finishedAt: Date.UTC(2019, 0, 1) },
        { id: "w-5", finishedAt: NOW + 3 * DAY },
        null,
      ],
      30,
      NOW,
    );
    expect(out).toEqual([
      { id: "w-2", source: "guided", title: "Workout", focus: "full-body", startedAt: NOW, finishedAt: NOW, durationMin: 1, exercises: [] },
      { id: "w-1", source: "guided", title: "Legs", focus: "lower", startedAt: NOW - DAY - 1800000, finishedAt: NOW - DAY, durationMin: 30, exercises: [
        { name: "Goblet squat", equipment: "bodyweight", targetReps: null, sets: [{ reps: 10, durationSec: null, load: "2×25 lb" }, { reps: null, durationSec: 40, load: "bodyweight" }] },
      ] },
    ]);
    expect(normalizeRecords("nope")).toEqual([]);
    expect(normalizeRecords([record("a", 0, []), record("b", 1, [])], 1, NOW).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("mergeHistory", () => {
  const entry = (r: WorkoutRecord, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ ...r, setsLogged: 9, loggedToPersonal: true, ...extra });
  it("adds the server's sessions, keeps a later local finish, and marks matching versions synced", () => {
    const remoteOnly = record("r", 2, [ex("Row", [[10, "40 lb"], [10, "40 lb"]])]);
    const same = record("s", 1, []);
    const newerHere = record("n", 0, []);
    const local = [entry(newerHere), entry(same, { synced: false })];
    const out = mergeHistory(local, [remoteOnly, same, { ...newerHere, finishedAt: newerHere.finishedAt - 60000 }]);
    expect(out.map((e) => [e.id, e.synced ?? false, e.setsLogged, e.loggedToPersonal])).toEqual([
      ["n", false, 9, true],
      ["s", true, 9, true],
      ["r", true, 2, false],
    ]);
    expect(mergeHistory(local, [remoteOnly], 2).map((e) => e.id)).toEqual(["n", "s"]);
  });
});
