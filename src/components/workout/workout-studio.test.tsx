// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/mobile-chrome", () => ({ PageHeader: () => null }));
vi.mock("@/lib/haptic", () => ({ haptic: vi.fn() }));
vi.mock("./workout-timer", () => ({
  beep: vi.fn(),
  unlockAudio: vi.fn(),
  useCountdownCues: vi.fn(),
  useNow: () => Date.now(),
  useWakeLock: vi.fn(),
}));
import { WorkoutStudio } from "./workout-studio";
import type { Exercise, WorkoutSession } from "@/lib/workout";

const exercise = (id: string, name: string, extra: Partial<Exercise> = {}): Exercise => ({
  id, name, pattern: "squat", equipment: "dumbbell", sets: 2, reps: 10, durationSec: null, restSec: 0, load: "2×25 lb dumbbells", cues: [], muscles: [], perSide: false, video: null, ...extra,
});
const session = (): WorkoutSession => ({
  id: "s1",
  plan: {
    title: "Legs", summary: "", focus: "lower", estimatedMinutes: 20,
    warmup: [],
    blocks: [{ name: "A", type: "straight", exercises: [exercise("m1", "Goblet squat"), exercise("m2", "Farmer carry", { durationSec: 40, reps: null, load: "2×50 lb" })] }],
    cooldown: [exercise("c1", "Hamstring stretch", { sets: 1, reps: null, durationSec: 30, load: "bodyweight" })],
  },
  equipment: [{ name: "Dumbbells", detail: "10–50 lb" }],
  startedAt: Date.now() - 600_000,
  finishedAt: null,
  stepIndex: 0,
  logs: [],
  timerEndsAt: null,
  timerKind: null,
  timerPausedRemainingMs: null,
});
const stored = () => JSON.parse(localStorage.getItem("personalos:workout:session")!) as WorkoutSession;
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
type Reply = { ok: boolean; status?: number; json: () => Promise<unknown> };
const video: Reply = { ok: true, json: async () => ({ video: null }) };
const mockFetch = (extend: Reply) => vi.fn(async (url: string, _init?: RequestInit): Promise<Reply> => (url.startsWith("/api/workout/extend") ? extend : video));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  localStorage.setItem("personalos:workout:session", JSON.stringify(session()));
  localStorage.setItem("personalos:workout:prefs", JSON.stringify({ minutes: 30, focus: "lower", intensity: "hard" }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function resume() {
  await act(async () => root.render(<WorkoutStudio />));
  await act(async () => button("Resume").click());
}

describe("weight mid-set", () => {
  it("steps the load by 5 lb, carries it to the next set and the log, and leaves logged sets alone", async () => {
    vi.stubGlobal("fetch", mockFetch(video));
    await resume();
    expect(container.textContent).toContain("Set 1 of 2");
    await act(async () => button("Log set").click());
    expect(stored().logs[0].load).toBe("2×25 lb dumbbells");
    expect(container.textContent).toContain("Set 2 of 2");
    await act(async () => byLabel("More weight (5 lb)").click());
    await act(async () => byLabel("More weight (5 lb)").click());
    await act(async () => byLabel("Less weight (5 lb)").click());
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Load"]')!.value).toBe("2×30 lb dumbbells");
    expect(stored().plan.blocks[0].exercises[0].load).toBe("2×30 lb dumbbells");
    expect(stored().logs[0].load).toBe("2×25 lb dumbbells");
    await act(async () => button("Log set").click());
    expect(stored().logs[1].load).toBe("2×30 lb dumbbells");
    // A timed carry gets the same stepper; a bodyweight stretch does not.
    expect(container.textContent).toContain("Farmer carry");
    await act(async () => byLabel("More weight (5 lb)").click());
    expect(stored().plan.blocks[0].exercises[1].load).toBe("2×55 lb");
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Load"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "heavy sandbag");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(stored().plan.blocks[0].exercises[1].load).toBe("heavy sandbag");
    expect(byLabel("More weight (5 lb)")).toBeFalsy();
  });
});

describe("adding time", () => {
  const extra = { blocks: [{ name: "B · Extra", type: "straight", exercises: [exercise("x1", "Reverse lunge", { sets: 1 })] }] };
  it("mid-session asks for more on the same equipment and slots it before the cool-down", async () => {
    const fetch = mockFetch({ ok: true, json: async () => extra });
    vi.stubGlobal("fetch", fetch);
    await resume();
    await act(async () => byLabel("Add 20 minutes of workout").click());
    await flush();
    const call = fetch.mock.calls.find((c) => String(c[0]).startsWith("/api/workout/extend"))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      minutes: 20, focus: "lower", intensity: "hard", equipment: [{ name: "Dumbbells", detail: "10–50 lb" }], exercises: ["Goblet squat", "Farmer carry", "Hamstring stretch"],
    });
    const s = stored();
    expect(s.plan.blocks.map((b) => b.name)).toEqual(["A", "B · Extra"]);
    expect(s.plan.cooldown[0].name).toBe("Hamstring stretch");
    expect(s.stepIndex).toBe(0);
    expect(container.textContent).toContain("Set 1 of 2");
  });
  it("from the summary reopens the session on the first new set, and shows the failure otherwise", async () => {
    const fetch = mockFetch({ ok: false, status: 502, json: async () => ({ error: "Couldn't add more work right now. Try again." }) });
    vi.stubGlobal("fetch", fetch);
    await resume();
    await act(async () => button("End workout").click());
    await act(async () => button("End").click());
    expect(container.textContent).toContain("Workout complete");
    await act(async () => byLabel("Add 10 minutes of workout").click());
    await flush();
    expect(container.textContent).toContain("Couldn't add more work right now.");
    fetch.mockImplementation(mockFetch({ ok: true, json: async () => extra }));
    await act(async () => byLabel("Add 10 minutes of workout").click());
    await flush();
    expect(container.textContent).toContain("Reverse lunge");
    expect(container.textContent).toContain("Set 1 of 1");
    const s = stored();
    expect(s.finishedAt).toBeNull();
    expect(s.stepIndex).toBe(4);
  });
});
