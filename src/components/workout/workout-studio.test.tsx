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
      minutes: 20, focus: "lower", intensity: "hard", equipment: [{ name: "Dumbbells", detail: "10–50 lb" }], exercises: ["Goblet squat", "Farmer carry", "Hamstring stretch"], history: [],
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

describe("the workout log", () => {
  const sets = [{ reps: 10, durationSec: null, load: "2×25 lb dumbbells" }, { reps: 10, durationSec: null, load: "2×25 lb dumbbells" }];
  const past = {
    id: "w-past", title: "Leg day", focus: "lower", startedAt: Date.now() - 2 * 86_400_000 - 1_800_000, finishedAt: Date.now() - 2 * 86_400_000, durationMin: 30,
    exercises: [{ name: "Goblet squat", equipment: "dumbbell", targetReps: 10, sets }],
  };
  const history = () => JSON.parse(localStorage.getItem("personalos:workout:history")!) as { id: string; synced?: boolean; exercises: { sets: unknown[] }[] }[];
  const routes = (handlers: Record<string, (init?: RequestInit) => unknown>) =>
    vi.fn(async (url: string, init?: RequestInit): Promise<Reply> => {
      const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
      const body = handlers[key]?.(init) ?? (url.startsWith("/api/workout/video") ? { video: null } : {});
      return { ok: true, json: async () => body };
    });

  it("finishes on the last set with that set logged, saves the session, and says what to lift next time", async () => {
    const s = session();
    s.plan.blocks[0].exercises = [exercise("m1", "Goblet squat")];
    s.plan.cooldown = [];
    localStorage.setItem("personalos:workout:session", JSON.stringify(s));
    const fetch = routes({ "POST /api/workout/history": (init) => ({ saved: (JSON.parse(String(init?.body)) as { records: { id: string; finishedAt: number }[] }).records.map(({ id, finishedAt }) => ({ id, finishedAt })), stored: true }) });
    vi.stubGlobal("fetch", fetch);
    await resume();
    await act(async () => button("Log set").click());
    await act(async () => button("Log set").click());
    await flush();
    expect(container.textContent).toContain("Workout complete");
    expect(stored().logs).toHaveLength(2);
    const upload = fetch.mock.calls.find((c) => c[0] === "/api/workout/history" && c[1]?.method === "POST")!;
    expect(JSON.parse(String(upload[1]?.body)).records[0]).toMatchObject({
      id: "s1", title: "Legs", focus: "lower", exercises: [{ name: "Goblet squat", equipment: "dumbbell", targetReps: 10, sets }],
    });
    expect(history()[0]).toMatchObject({ id: "s1", synced: true });
    expect(container.textContent).toContain("10, 10 @ 2×25 lb dumbbells");
    expect(container.textContent).toContain("Next time 2×30 lb dumbbells · +5 lb: every rep at 25 lb");
  });

  it("sends the log with the plan request and starts a repeat exercise from the advised weight", async () => {
    localStorage.removeItem("personalos:workout:session");
    localStorage.setItem("personalos:workout:history", JSON.stringify([{ ...past, setsLogged: 2, loggedToPersonal: false, synced: true }]));
    localStorage.setItem("personalos:workout:equipment", JSON.stringify([{ name: "Dumbbells", detail: "10–50 lb" }]));
    const plan = {
      equipment: [{ name: "Dumbbells" }],
      plan: { title: "Lower", summary: "", focus: "lower", estimatedMinutes: 30, warmup: [], cooldown: [],
        blocks: [{ name: "A", type: "straight", exercises: [exercise("p1", "Goblet squat", { load: "2×20 lb dumbbells" }), exercise("p2", "Reverse lunge")] }] },
    };
    const fetch = routes({ "POST /api/workout/plan": () => plan });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<WorkoutStudio />));
    await act(async () => button("Build my workout").click());
    await flush();
    const call = fetch.mock.calls.find((c) => c[0] === "/api/workout/plan")!;
    expect(JSON.parse(String((call[1]?.body as FormData).get("history")))).toEqual([past]);
    expect(container.textContent).toContain("2 × 10 · 2×30 lb dumbbells");
    expect(container.textContent).toContain("Last · ");
    expect(container.textContent).toContain(": 10, 10 @ 2×25 lb dumbbells");
    expect(container.textContent).toContain("↑ +5 lb: every rep at 25 lb");
    expect(container.textContent).toContain("2 × 10 · 2×25 lb dumbbells"); // the lunge keeps the plan's load
  });

  it("brings in sessions logged on another device and opens a past session to its sets", async () => {
    localStorage.removeItem("personalos:workout:session");
    vi.stubGlobal("fetch", routes({ "GET /api/workout/history": () => ({ records: [past], stored: true }) }));
    await act(async () => root.render(<WorkoutStudio />));
    await flush();
    expect(container.textContent).toContain("Leg day");
    expect(container.textContent).not.toContain("Goblet squat");
    await act(async () => button("Leg day").click());
    expect(container.textContent).toContain("Goblet squat10, 10 @ 2×25 lb dumbbells");
    expect(history()[0]).toMatchObject({ id: "w-past", synced: true });
  });
});

describe("full gym, health data and what's coming up", () => {
  const routes = (handlers: Record<string, (init?: RequestInit) => unknown>) =>
    vi.fn(async (url: string, init?: RequestInit): Promise<Reply> => {
      const body = handlers[`${init?.method ?? "GET"} ${url.split("?")[0]}`]?.(init) ?? (url.startsWith("/api/workout/video") ? { video: null } : {});
      return { ok: true, json: async () => body };
    });

  it("plans for a full gym, shows the health data used, and holds weights on a low-recovery day", async () => {
    localStorage.removeItem("personalos:workout:session");
    localStorage.setItem("personalos:workout:equipment", JSON.stringify([{ name: "Kettlebell", detail: "35 lb" }]));
    localStorage.setItem("personalos:workout:history", JSON.stringify([{
      id: "w-past", title: "Leg day", focus: "lower", startedAt: Date.now() - 86_400_000 * 2, finishedAt: Date.now() - 86_400_000 * 2 + 1_800_000, durationMin: 30,
      setsLogged: 2, loggedToPersonal: false, synced: true,
      exercises: [{ name: "Back squat", equipment: "barbell", targetReps: 5, sets: [{ reps: 5, durationSec: null, load: "185 lb" }, { reps: 5, durationSec: null, load: "185 lb" }] }],
    }]));
    const reply = {
      equipment: [{ name: "Olympic barbells & plates" }, { name: "Smith machine" }],
      fullGym: true,
      health: { facts: ["182 lb", "HRV 40 ms · avg 55"], readiness: "low", note: "HRV 40 ms is 27% under your 30-day average (55)." },
      plan: { title: "Gym legs", summary: "", focus: "lower", estimatedMinutes: 45, warmup: [], cooldown: [],
        blocks: [{ name: "A", type: "straight", exercises: [exercise("g1", "Back squat", { equipment: "barbell", reps: 5, load: "195 lb" }), exercise("g2", "Leg press", { equipment: "machine", load: "270 lb" })] }] },
    };
    const fetch = routes({ "POST /api/workout/plan": () => reply });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<WorkoutStudio />));
    expect(container.textContent).toContain("Equipment photos");
    await act(async () => button("Full gym").click());
    expect(container.textContent).not.toContain("Equipment photos");
    expect(container.textContent).toContain("No photos needed.");
    expect(JSON.parse(localStorage.getItem("personalos:workout:prefs")!).fullGym).toBe(true);
    await act(async () => button("Build my workout").click());
    await flush();
    const form = fetch.mock.calls.find((c) => c[0] === "/api/workout/plan")![1]?.body as FormData;
    expect(form.get("fullGym")).toBe("1");
    expect(form.get("knownEquipment")).toBeNull();
    expect(form.getAll("photos")).toEqual([]);
    expect(container.textContent).toContain("From your health data");
    expect(container.textContent).toContain("HRV 40 ms · avg 55");
    expect(container.textContent).toContain("Recovery is low. HRV 40 ms is 27% under your 30-day average (55). No weight increases today.");
    expect(container.textContent).not.toContain("Smith machine");
    expect(container.textContent).toContain("2 × 5 · 185 lb");
    expect(container.textContent).toContain("Recovery is low today: holding 185 lb");
    await act(async () => button("Start workout").click());
    expect(stored().readiness).toBe("low");
    expect(JSON.parse(localStorage.getItem("personalos:workout:equipment")!)).toEqual([{ name: "Kettlebell", detail: "35 lb" }]);
  });

  it("shows the rest of the session mid-set, and moves on as sets are logged", async () => {
    vi.stubGlobal("fetch", mockFetch(video));
    await resume();
    const comingUp = () => container.querySelector("section.mt-6")?.textContent ?? "";
    expect(comingUp()).toContain("Coming up");
    expect(comingUp()).toContain("Goblet squat1 more set of 10 · 2×25 lb dumbbells");
    expect(comingUp()).toContain("Farmer carry2 × 40s · 2×50 lb");
    expect(comingUp()).toContain("Cool-downHamstring stretch1 × 30s · bodyweight");
    await act(async () => button("Log set").click());
    expect(comingUp()).not.toContain("Goblet squat");
    expect(comingUp()).toContain("Farmer carry2 × 40s");
  });
});
