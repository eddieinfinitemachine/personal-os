import { describe, expect, it } from "vitest";
import { boardRecord, buildBoardPrompt, buildBoardUserPrompt, normalizeBoard, parseSetsText, setsText, type BoardDraft } from "./workout-board";

describe("normalizeBoard", () => {
  it("coerces Claude's reading of the board into a draft", () => {
    const out = normalizeBoard({
      title: " Fran ",
      focus: "conditioning",
      format: "For time",
      amrap: "yes",
      timeCapMin: "10",
      exercises: [
        { name: "Thruster", equipment: "barbell", load: "95 lb", sets: [21, "15", { reps: 9 }] },
        { name: "Plank", load: "", sets: ["45s", { durationSec: 30 }, "x"] },
        { name: "400 m run", sets: 1 },
        { name: "", sets: [5] },
        { name: "Nothing", sets: [] },
        "Burpees",
      ],
      notes: "Scale: 65 lb",
    });
    expect(out).toEqual({
      title: "Fran", focus: "conditioning", format: "For time", amrap: false, timeCapMin: 10, notes: "Scale: 65 lb",
      exercises: [
        { name: "Thruster", equipment: "barbell", load: "95 lb", sets: [{ reps: 21, durationSec: null }, { reps: 15, durationSec: null }, { reps: 9, durationSec: null }] },
        { name: "Plank", equipment: "bodyweight", load: "bodyweight", sets: [{ reps: null, durationSec: 45 }, { reps: null, durationSec: 30 }] },
        { name: "400 m run", equipment: "bodyweight", load: "bodyweight", sets: [{ reps: 1, durationSec: null }] },
      ],
    });
    expect(normalizeBoard({ exercises: [{ name: "Row", sets: [10] }], focus: "nope", amrap: true }).focus).toBe("conditioning");
    expect(normalizeBoard({ exercises: [{ name: "Row", sets: [10] }], amrap: true }).amrap).toBe(true);
  });
  it("fails with Claude's reason when there's no workout", () => {
    expect(() => normalizeBoard({ error: "That's a lunch menu" })).toThrow("That's a lunch menu");
    expect(() => normalizeBoard({ exercises: [] })).toThrow("no workout on the board");
    expect(() => normalizeBoard(null)).toThrow();
  });
});

describe("sets as text", () => {
  it("reads lists, NxM shorthand and seconds, and writes them back", () => {
    const sets = (t: string) => setsText(parseSetsText(t));
    expect(sets("21, 15, 9")).toBe("21, 15, 9");
    expect(sets("5x5")).toBe("5, 5, 5, 5, 5");
    expect(sets("5 × 5")).toBe("5, 5, 5, 5, 5");
    expect(sets("3x40s")).toBe("40s, 40s, 40s");
    expect(sets("45 s; 45sec")).toBe("45s, 45s");
    expect(sets("2x10, 8")).toBe("10, 10, 8");
    expect(sets("ten, 7")).toBe("7");
    expect(parseSetsText("100x5")).toHaveLength(30);
  });
});

describe("boardRecord", () => {
  const draft: BoardDraft = {
    title: "Cindy-ish", focus: "conditioning", format: "AMRAP 20 min", amrap: true, timeCapMin: 20, notes: "Scale ring rows",
    exercises: [
      { name: "Pull-up", equipment: "pull-up bar", load: "bodyweight", sets: [{ reps: 5, durationSec: null }] },
      { name: " Push-up ", equipment: "bodyweight", load: "", sets: [{ reps: 10, durationSec: null }] },
      { name: "", equipment: "x", load: "", sets: [{ reps: 1, durationSec: null }] },
    ],
  };
  const at = Date.UTC(2026, 9, 17, 18);
  it("repeats an AMRAP round for the rounds completed and keeps the format and score", () => {
    expect(boardRecord(draft, { id: "b-1", finishedAt: at, durationMin: 20, rounds: 3, score: " 3 + 4 " })).toEqual({
      id: "b-1", source: "board", title: "Cindy-ish", focus: "conditioning", startedAt: at - 20 * 60000, finishedAt: at, durationMin: 20,
      notes: "AMRAP 20 min · Score 3 + 4 · Scale ring rows",
      exercises: [
        { name: "Pull-up", equipment: "pull-up bar", targetReps: 5, sets: Array(3).fill({ reps: 5, durationSec: null, load: "bodyweight" }) },
        { name: "Push-up", equipment: "bodyweight", targetReps: 10, sets: Array(3).fill({ reps: 10, durationSec: null, load: "bodyweight" }) },
      ],
    });
  });
  it("keeps a rep scheme as is, with no rep target when the sets differ", () => {
    const fran: BoardDraft = { ...draft, amrap: false, format: "For time", notes: "", exercises: [{ name: "Thruster", equipment: "barbell", load: "95 lb", sets: [21, 15, 9].map((reps) => ({ reps, durationSec: null })) }] };
    const r = boardRecord(fran, { id: "b-2", finishedAt: at, durationMin: 0, rounds: 5, score: "" });
    expect(r.notes).toBe("For time");
    expect(r.durationMin).toBe(1);
    expect(r.exercises[0]).toEqual({ name: "Thruster", equipment: "barbell", targetReps: null, sets: [21, 15, 9].map((reps) => ({ reps, durationSec: null, load: "95 lb" })) });
  });
});

describe("board prompts", () => {
  it("asks for one-round AMRAPs and Rx by sex", () => {
    expect(buildBoardPrompt()).toContain("sets = ONE round");
    expect(buildBoardPrompt()).toContain('"95/65" are men\'s/women\'s');
    expect(buildBoardUserPrompt("F", " partner WOD ")).toBe("Read the workout on this whiteboard.\nThe athlete is female.\nNotes from the athlete: partner WOD");
    expect(buildBoardUserPrompt(null, "")).toBe("Read the workout on this whiteboard.");
  });
});
