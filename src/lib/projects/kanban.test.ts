import { describe, expect, it } from "vitest";
import { bucketCards, type BoardCard, type Visibility } from "./board-model";
import { dropVisibility, kanban, nextStep, stageOf } from "./kanban";

// The cases of ec's ProjectTests.testTheKanbanSortsCardsByWhoseMoveItIs.
const NOW = Date.now();
function staged(
  name: string,
  visibility: Visibility = "auto",
  { stale = false, waitingOn = null as string | null, hoursAgo = 1 } = {},
): BoardCard {
  return {
    id: `inferred:${name}`,
    name,
    company: "Personal",
    visibility,
    lastActivityAt: new Date(NOW - hoursAgo * 3600_000).toISOString(),
    status: null,
    next: "Do it",
    steps: [
      { text: "Do it", due: null, who: waitingOn, waiting: waitingOn !== null },
      { text: "Then this", due: null, who: "Ana", waiting: true },
    ],
    problem: null,
    evidence: [],
    stale,
    sourceId: name,
  };
}

const mine = staged("Mine");
const pinned = staged("Pinned", "pinned", { hoursAgo: 9 });
const theirs = staged("Theirs", "auto", { waitingOn: "Kepler" });
const quiet = staged("Quiet", "auto", { stale: true, waitingOn: "Kepler" });
const done = staged("Done", "finished");
const hidden = staged("Hidden", "hidden");

describe("kanban", () => {
  it("puts each card in a column by whose move it is", () => {
    expect([mine, theirs, quiet, done, hidden].map(stageOf)).toEqual(["onMe", "waiting", "quiet", "finished", null]);
    expect(stageOf({ ...mine, next: null, steps: [] })).toBe("onMe");
  });

  it("shows all four columns in order, keeping the board's order within each", () => {
    const columns = kanban(bucketCards([mine, pinned, theirs, quiet, done, hidden]));
    expect(columns.map((c) => c.stage)).toEqual(["onMe", "waiting", "quiet", "finished"]);
    expect(columns.map((c) => c.cards.map((x) => x.name))).toEqual([["Pinned", "Mine"], ["Theirs"], ["Quiet"], ["Done"]]);
    expect(kanban({ cards: [], finished: [] }).map((c) => c.cards.length)).toEqual([0, 0, 0, 0]);
  });

  it("only Finished takes a drop, and a finished card reopens when it's dropped elsewhere", () => {
    expect(dropVisibility(mine, "finished")).toBe("finished");
    expect(dropVisibility(done, "onMe")).toBe("auto");
    expect(dropVisibility(done, "quiet")).toBe("auto");
    expect(dropVisibility(mine, "waiting")).toBeNull();
    expect(dropVisibility(done, "finished")).toBeNull();
    expect(dropVisibility(hidden, "finished")).toBeNull();
  });

  it("leads the next step with 'Next:' or 'Waiting on <who>:'", () => {
    expect(nextStep(mine)?.label).toBe("Next:");
    expect(nextStep(theirs)?.label).toBe("Waiting on Kepler:");
    expect(nextStep(theirs)?.text).toBe("Do it");
    expect(nextStep(done)).toBeNull();
    // Waiting with nobody named: the column says Waiting, the line says Next.
    const unnamed = { ...mine, steps: [{ text: "Do it", due: null, who: null, waiting: true }] };
    expect(stageOf(unnamed)).toBe("waiting");
    expect(nextStep(unnamed)?.label).toBe("Next:");
  });
});
