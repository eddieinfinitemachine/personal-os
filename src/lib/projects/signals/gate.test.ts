import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { createGate, type GateContext } from "./gate";

const ctx = (over: Partial<GateContext> = {}): GateContext => ({
  datingNames: ["Jordan Vale", "Jordan"],
  familyNames: ["Pat Synthetic"],
  blockedEmails: new Set(["jordan@example.invalid", "aunt@example.invalid"]),
  datingNoteIds: new Set(["not_dating"]),
  ...over,
});

describe("createGate", () => {
  it("excludes each private class and counts it by rule", () => {
    const gate = createGate(ctx());
    const cases: [Parameters<typeof gate.excludes>[0], string][] = [
      [{ title: "Board prep", private: true }, "private"],
      [{ title: "Board prep", granolaId: "not_dating" }, "dating-record"],
      [{ title: "Lunch", emails: ["Jordan@Example.invalid"] }, "contact"],
      [{ title: "Therapy" }, "therapy"],
      [{ title: "Drinks", text: "with Jordan after work" }, "dating"],
      [{ title: "Hinge profile" }, "dating"],
      [{ title: "Dentist", text: "" }, "health"],
      [{ title: "Call", text: "pick up the prescription" }, "health"],
      [{ title: "Mom's birthday dinner" }, "family"],
      [{ title: "Visit", text: "see Pat Synthetic" }, "family"],
    ];
    for (const [input] of cases) expect(gate.excludes(input)).toBe(true);
    expect(gate.counts).toEqual({
      private: 1,
      "dating-record": 1,
      "excluded-meeting": 0,
      contact: 1,
      therapy: 1,
      dating: 2,
      health: 2,
      family: 2,
    });
  });

  it("lets work through, and tracks excluded notes for their todos", () => {
    const gate = createGate(ctx());
    expect(gate.excludes({ title: "ERP migration review", text: "inventory sync plan", emails: ["ops@vendor.example"] })).toBe(false);
    expect(gate.excludes({ title: "Therapy", granolaId: "not_t" })).toBe(true);
    expect(gate.excludes({ title: "Send the invoice", fromNoteId: "not_t" })).toBe(true);
    expect(gate.excludes({ title: "Send the invoice", fromNoteId: "not_work" })).toBe(false);
    expect(gate.counts["excluded-meeting"]).toBe(1);
  });

  it("checks model text without counting", () => {
    const gate = createGate(ctx());
    expect(gate.matchesText("Help Jordan move")).toBe(true);
    expect(gate.matchesText("Inventory financing")).toBe(false);
    expect(gate.matchesText(null)).toBe(false);
    expect(Object.values(gate.counts).every((n) => n === 0)).toBe(true);
  });
});
