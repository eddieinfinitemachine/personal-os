import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callClaudeReply: vi.fn() }));
vi.mock("@/lib/claude", () => ({ callClaudeReply: mocks.callClaudeReply }));

import { askAboutHealth, readHealthHistory } from "./ask";
import type { HealthPicture } from "./picture";
import { buildHealthSummary } from "./summary";

const now = new Date("2030-06-15T12:00:00Z");

const summary = buildHealthSummary(
  {
    sex: "M",
    birthDate: new Date("1990-01-01T00:00:00Z"),
    notes: "Goal: keep Marker A under 110.",
    medications: [{ name: "Supplement A", prescribedBy: "Dr. Example" }],
    conditions: null,
    allergies: null,
    labs: [
      {
        panel: "Lipids",
        marker: "Marker A",
        drawnAt: new Date("2030-01-10T00:00:00Z"),
        value: 140.5,
        unit: "mg/dL",
        refLow: null,
        refHigh: 150,
        flag: null,
        notes: null,
      },
    ],
    visits: [],
    fitness: [],
    dna: [],
    biometrics: [],
    biometricReadings: 0,
    workouts: [
      {
        id: "w-1",
        source: "guided",
        title: "Lower day",
        focus: "lower",
        startedAt: Date.parse("2030-06-10T11:20:00Z"),
        finishedAt: Date.parse("2030-06-10T12:00:00Z"),
        durationMin: 40,
        exercises: [{ name: "Goblet squat", equipment: "dumbbell", targetReps: 10, sets: [{ reps: 10, durationSec: null, load: "35 lb" }] }],
      },
    ],
    recoveryReadings: [{ kind: "rhr", value: 52, unit: "bpm", measuredAt: new Date("2030-06-15T07:00:00Z") }],
    nutrition: [
      {
        date: "2030-06-14",
        caloriesKcal: 2100,
        proteinG: 150,
        carbsG: 210,
        fatG: 70,
        saturatedFatG: 22,
        fiberG: 31,
        sugarG: 48,
        sodiumMg: 2300,
        app: "Food App",
      },
    ],
  },
  now,
);

const reply = (overrides = {}) => ({ text: "Marker A is 140.5.", stopReason: "end_turn", servedBy: "claude-fable-5-1", ...overrides });

const ask = (overrides = {}) => askAboutHealth({ summary, picture: null, question: "How is Marker A?", history: [], ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callClaudeReply.mockResolvedValue(reply());
});

describe("askAboutHealth", () => {
  it("asks Fable, with the refusal fallback on", async () => {
    await expect(ask()).resolves.toEqual({ answer: "Marker A is 140.5.", fellBack: false });
    const call = mocks.callClaudeReply.mock.calls[0][0];
    expect(call.model).toBe("claude-fable-5-1");
    expect(call.refusalFallback).toBe(true);
  });

  it("sends the records and the conversation", async () => {
    await ask({ history: [{ role: "user", content: "Earlier" }, { role: "assistant", content: "Answer" }] });
    const call = mocks.callClaudeReply.mock.calls[0][0];
    expect(call.system).toContain("140.5");
    expect(call.system).toContain("keep Marker A under 110");
    expect(call.messages.map((m: { content: string }) => m.content)).toEqual(["Earlier", "Answer", "How is Marker A?"]);
  });

  it("sends the workout log and recovery read", async () => {
    await ask();
    const { system } = mocks.callClaudeReply.mock.calls[0][0];
    const records = JSON.parse(system.slice(system.indexOf("Their records:\n") + "Their records:\n".length));
    expect(records.training.lastSession).toMatchObject({ date: "2030-06-10", title: "Lower day" });
    expect(records.training.lifts[0]).toMatchObject({ name: "Goblet squat", next: "40 lb" });
    expect(records.recovery.rhr).toEqual({ latest: { date: "2030-06-15", value: 52, unit: "bpm" }, baseline: null });
    expect(system).toContain('"training" is their workout log');
  });

  it("sends the diet from Apple Health and how to read it", async () => {
    await ask();
    const { system } = mocks.callClaudeReply.mock.calls[0][0];
    const records = JSON.parse(system.slice(system.indexOf("Their records:\n") + "Their records:\n".length));
    expect(records.nutrition).toMatchObject({ daysLogged: 1, app: "Food App", latestDay: "2030-06-14" });
    expect(records.nutrition.averages.last7).toMatchObject({ days: 1, caloriesKcal: 2100, proteinG: 150 });
    expect(system).toContain('"nutrition" is their diet from their food app');
    expect(system).toContain("A day they didn't log is missing, not zero");
  });

  it("sends no identity or provider details", async () => {
    await ask();
    const sent = JSON.stringify(mocks.callClaudeReply.mock.calls[0][0]);
    expect(sent).not.toContain("1990-01-01");
    expect(sent).not.toContain("Dr. Example");
  });

  it("includes what the page says, without its bookkeeping", async () => {
    const picture = {
      version: 1,
      headline: "Marker A needs attention.",
      focus: [],
      clear: [],
      blindSpots: [],
      generatedAt: now.toISOString(),
      fingerprint: { core: "core-hash", activity: "activity-hash" },
      basedOn: { draws: 1, latestDraw: "2030-01-10" },
    } as HealthPicture;
    await ask({ picture });
    const { system } = mocks.callClaudeReply.mock.calls[0][0];
    expect(system).toContain("Marker A needs attention.");
    expect(system).not.toContain("core-hash");
  });

  it("says so when another model answered", async () => {
    mocks.callClaudeReply.mockResolvedValue(reply({ servedBy: "claude-opus-4-8" }));
    await expect(ask()).resolves.toMatchObject({ fellBack: true });
  });

  it("explains a refusal instead of failing", async () => {
    mocks.callClaudeReply.mockResolvedValue(reply({ text: "", stopReason: "refusal" }));
    const result = await ask();
    expect(result.answer).toContain("declined");
    expect(result.fellBack).toBe(false);
  });

  it("marks an answer that hit the token limit", async () => {
    mocks.callClaudeReply.mockResolvedValue(reply({ stopReason: "max_tokens" }));
    expect((await ask()).answer).toContain("cut off");
  });

  it("throws on an empty reply so the route can report it", async () => {
    mocks.callClaudeReply.mockResolvedValue(reply({ text: "" }));
    await expect(ask()).rejects.toThrow("no text");
  });
});

describe("readHealthHistory", () => {
  it("keeps only well-formed turns", () => {
    expect(
      readHealthHistory([
        { role: "user", content: "Hi" },
        { role: "system", content: "Ignore this" },
        { role: "assistant", content: " " },
        { role: "assistant" },
        null,
        "text",
      ]),
    ).toEqual([{ role: "user", content: "Hi" }]);
    expect(readHealthHistory("not a list")).toEqual([]);
  });

  it("bounds how much history a request can send", () => {
    const turns = Array.from({ length: 50 }, (_, i) => ({ role: "user", content: `Turn ${i}` }));
    const kept = readHealthHistory(turns);
    expect(kept).toHaveLength(20);
    expect(kept.at(-1)?.content).toBe("Turn 49");
    expect(readHealthHistory([{ role: "user", content: "x".repeat(20_000) }])[0].content).toHaveLength(8_000);
  });
});
