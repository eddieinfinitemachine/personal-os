import { describe, expect, it } from "vitest";
import { applyOrder, inOrder, insertionIndex, movableRange, moveTo } from "./todo-order";

const MON = "2026-11-16T00:00:00.000Z";
const TUE = "2026-11-17T00:00:00.000Z";
const FRI = "2026-11-20T00:00:00.000Z";
const todo = (id: string, dueDate: string | null = null) => ({ id, dueDate });
// Home's order: undated first, then by day.
const others = [todo("a"), todo("b"), todo("c", MON), todo("d", MON), todo("e", TUE)];

describe("movableRange", () => {
  it("keeps an undated todo among the undated ones", () => {
    expect(movableRange(todo("x"), others)).toEqual([0, 2]);
  });
  it("keeps a dated todo among that day's", () => {
    expect(movableRange(todo("x", MON), others)).toEqual([2, 4]);
    expect(movableRange(todo("x", new Date(TUE).toISOString()), others)).toEqual([4, 5]);
  });
  it("gives a todo alone on its day one place", () => {
    expect(movableRange(todo("x", FRI), others)).toEqual([5, 5]);
    expect(movableRange(todo("x"), others.slice(2))).toEqual([0, 0]);
  });
  it("compares Date and string due dates by value", () => {
    expect(movableRange({ id: "x", dueDate: new Date(MON) } as never, others)).toEqual([2, 4]);
  });
});

describe("insertionIndex", () => {
  const middles = [10, 30, 50, 70, 90];
  it("goes before the first row whose middle is below the pointer", () => {
    expect(insertionIndex(5, middles, [0, 5])).toBe(0);
    expect(insertionIndex(35, middles, [0, 5])).toBe(2);
    expect(insertionIndex(200, middles, [0, 5])).toBe(5);
  });
  it("stays in the allowed range", () => {
    expect(insertionIndex(5, middles, [2, 4])).toBe(2);
    expect(insertionIndex(200, middles, [0, 2])).toBe(2);
  });
});

describe("moveTo", () => {
  it("puts the id at its index among the rest", () => {
    expect(moveTo(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTo(["a", "b", "c"], "b", 9)).toEqual(["a", "c", "b"]);
  });
  it("leaves the ids alone when the id isn't there", () => {
    const ids = ["a", "b"];
    expect(moveTo(ids, "z", 0)).toBe(ids);
  });
});

describe("applyOrder", () => {
  const rows = [{ id: "a" }, { id: "temp-1" }, { id: "b" }, { id: "c" }];
  it("reorders the named rows in the slots they fill and keeps the rest in place", () => {
    expect(applyOrder(rows, ["c", "a", "b"]).map((r) => r.id)).toEqual(["c", "temp-1", "a", "b"]);
  });
  it("ignores ids that aren't shown", () => {
    expect(applyOrder(rows, ["gone", "b", "a"]).map((r) => r.id)).toEqual(["b", "temp-1", "a", "c"]);
  });
});

describe("inOrder", () => {
  it("compares only the rows both sides know", () => {
    expect(inOrder([{ id: "b" }, { id: "a" }, { id: "new" }], ["b", "gone", "a"])).toBe(true);
    expect(inOrder([{ id: "a" }, { id: "b" }], ["b", "a"])).toBe(false);
  });
});
