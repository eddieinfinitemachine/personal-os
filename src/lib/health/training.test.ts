import { describe, expect, it } from "vitest";
import type { ExerciseRecord, WorkoutRecord } from "@/lib/workout-history";
import { summarizeTraining } from "./training";

const DAY = 86_400_000;
// A Wednesday; its week starts Monday 2030-06-10.
const now = new Date("2030-06-12T12:00:00Z");

const lift = (name: string, load: string, reps = [10, 10, 10], targetReps: number | null = 10): ExerciseRecord => ({
  name,
  equipment: "dumbbell",
  targetReps,
  sets: reps.map((r) => ({ reps: r, durationSec: null, load })),
});

let seq = 0;
const workout = (finishedAt: Date | number, exercises: ExerciseRecord[] = [], extra: Partial<WorkoutRecord> = {}): WorkoutRecord => {
  const at = typeof finishedAt === "number" ? now.getTime() - finishedAt * DAY : finishedAt.getTime();
  return {
    id: `w-${++seq}`,
    source: "guided",
    title: "Session",
    focus: "full-body",
    startedAt: at - 40 * 60_000,
    finishedAt: at,
    durationMin: 40,
    exercises,
    ...extra,
  };
};

describe("summarizeTraining", () => {
  it("handles an empty log", () => {
    const t = summarizeTraining([], now);
    expect(t).toMatchObject({
      windowDays: 90,
      sessions: 0,
      minutes: 0,
      bySource: { guided: 0, board: 0, strava: 0 },
      byFocus: {},
      sessionsPerWeek: null,
      lastSession: null,
      recent: [],
      lifts: [],
      cardio: [],
    });
    expect(t.weeks).toHaveLength(12);
    expect(t.weeks.every((w) => w.sessions === 0 && w.minutes === 0)).toBe(true);
  });

  it("buckets weeks Monday to Sunday in UTC, newest first", () => {
    const t = summarizeTraining(
      [
        workout(new Date("2030-06-09T23:30:00Z"), [], { durationMin: 30 }),
        workout(new Date("2030-06-10T00:30:00Z"), [], { durationMin: 45 }),
      ],
      now,
    );
    expect(t.weeks[0]).toEqual({ weekStart: "2030-06-10", sessions: 1, minutes: 45 });
    expect(t.weeks[1]).toEqual({ weekStart: "2030-06-03", sessions: 1, minutes: 30 });
    expect(t.weeks[11].weekStart).toBe("2030-03-25");
    expect(t.minutes).toBe(75);
  });

  it("counts sessions per week since the first one in the window, at least a week", () => {
    expect(summarizeTraining([workout(14), workout(7), workout(1)], now).sessionsPerWeek).toBe(1.5);
    expect(summarizeTraining([workout(2)], now).sessionsPerWeek).toBe(1);
    // Older than the window: not counted.
    const t = summarizeTraining([workout(120), workout(28), workout(21), workout(14), workout(7)], now);
    expect(t.sessions).toBe(4);
    expect(t.sessionsPerWeek).toBe(1);
  });

  it("counts by source and focus, and reports the latest session", () => {
    const t = summarizeTraining(
      [
        workout(5, [], { source: "strava", title: "Morning run", focus: "conditioning" }),
        workout(3, [lift("Row", "30 lb")], { source: "board", title: "Class", focus: "pull" }),
        workout(1, [lift("Press", "20 lb")], { title: "Upper day", focus: "upper", durationMin: 50 }),
      ],
      now,
    );
    expect(t.bySource).toEqual({ guided: 1, board: 1, strava: 1 });
    expect(t.byFocus).toEqual({ conditioning: 1, pull: 1, upper: 1 });
    expect(t.lastSession).toEqual({ date: "2030-06-11", title: "Upper day", focus: "upper", durationMin: 50, source: "guided" });
    expect(t.recent.map((r) => [r.title, r.exercises])).toEqual([
      ["Upper day", 1],
      ["Class", 1],
      ["Morning run", 0],
    ]);
  });

  it("groups lifts by movement, with first and last sets, the next load and the change", () => {
    const t = summarizeTraining(
      [
        workout(30, [lift("Goblet Squat", "25 lb dumbbell"), lift("Push-up", "bodyweight")]),
        workout(20, [lift("Floor press", "20 kg")]),
        workout(10, [lift("Goblet squat (heavy)", "35 lb dumbbell"), lift("Floor Press", "45 lb")]),
      ],
      now,
    );
    expect(t.lifts.map((l) => [l.name, l.times])).toEqual([
      ["Goblet squat (heavy)", 2],
      ["Floor Press", 2],
      ["Push-up", 1],
    ]);
    const squat = t.lifts[0];
    expect(squat.first).toEqual({ date: "2030-05-13", sets: "10, 10, 10 @ 25 lb dumbbell" });
    expect(squat.last).toEqual({ date: "2030-06-02", sets: "10, 10, 10 @ 35 lb dumbbell" });
    expect(squat.next).toBe("40 lb dumbbell");
    expect(squat.loadChange).toEqual({ from: 25, to: 35, unit: "lb" });
    // Units differ: no change to report.
    expect(t.lifts[1].loadChange).toBeNull();
    // Done once, and bodyweight: nothing to move.
    expect(t.lifts[2]).toMatchObject({ next: null, loadChange: null });
  });

  it("lists sessions without sets as cardio, newest first", () => {
    const t = summarizeTraining(
      [
        workout(6, [], { source: "strava", title: "Ride", notes: "20 mi" }),
        workout(4, [lift("Row", "30 lb")]),
        workout(2, [], { source: "strava", title: "Run", notes: "6.2 mi · avg HR 148" }),
      ],
      now,
    );
    expect(t.cardio).toEqual([
      { date: "2030-06-10", title: "Run", durationMin: 40, notes: "6.2 mi · avg HR 148", source: "strava" },
      { date: "2030-06-06", title: "Ride", durationMin: 40, notes: "20 mi", source: "strava" },
    ]);
  });

  it("caps lifts, cardio and recent sessions", () => {
    const lifts = Array.from({ length: 25 }, (_, i) => lift(`Move ${i}`, "10 lb"));
    const cardio = Array.from({ length: 15 }, (_, i) => workout(i + 2, [], { source: "strava" }));
    const t = summarizeTraining([workout(1, lifts), ...cardio], now);
    expect(t.lifts).toHaveLength(20);
    expect(t.cardio).toHaveLength(10);
    expect(t.recent).toHaveLength(8);
    expect(t.sessions).toBe(16);
  });
});
