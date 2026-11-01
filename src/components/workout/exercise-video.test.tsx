// @vitest-environment jsdom
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExerciseVideoEmbed, ExerciseVideoToggle, planExercises, useExerciseVideos, withVideo } from "./exercise-video";
import type { Exercise, ExerciseVideo, WorkoutPlan } from "@/lib/workout";

const exercise = (id: string, name: string, extra: Partial<Exercise> = {}): Exercise => ({
  id, name, pattern: "squat", equipment: "kettlebell", sets: 3, reps: 10, durationSec: null, restSec: 60, load: "16 kg", cues: [], muscles: [], perSide: false, ...extra,
});
const plan = (): WorkoutPlan => ({
  title: "T", summary: "", focus: "full-body", estimatedMinutes: 30,
  warmup: [exercise("w1", "Arm circles")],
  blocks: [{ name: "A", type: "superset", exercises: [exercise("m1", "Goblet Squat"), exercise("m2", "goblet-squat"), exercise("m3", "Plank", { video: null })] }],
  cooldown: [],
});
const video: ExerciseVideo = { youtubeId: "dQw4w9WgXcQ", title: "Goblet Squat Form", channel: "Coach A" };

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("withVideo", () => {
  it("sets one exercise's video anywhere on the plan and keeps the object when nothing changes", () => {
    const p = plan();
    const next = withVideo(p, "m2", video);
    expect(planExercises(next).map((e) => e.video)).toEqual([undefined, undefined, video, null]);
    expect(next.blocks[0].exercises[0]).toBe(p.blocks[0].exercises[0]);
    expect(withVideo(next, "m2", video)).toBe(next);
    expect(withVideo(p, "nope", video)).toBe(p);
  });
});

describe("useExerciseVideos", () => {
  function Probe({ plan, onVideo }: { plan: WorkoutPlan | null; onVideo: (id: string, v: ExerciseVideo | null) => void }) {
    useExerciseVideos(plan, onVideo);
    return null;
  }
  function UpdatingPlan({ initial }: { initial: WorkoutPlan }) {
    const [current, setCurrent] = useState(initial);
    useExerciseVideos(current, (id, found) => setCurrent((p) => withVideo(p, id, found)));
    return <output>{JSON.stringify(planExercises(current).map((e) => ({ id: e.id, video: e.video })))}</output>;
  }
  function pendingLookups() {
    const requests: Array<{ signal: AbortSignal; resolve: (video: ExerciseVideo | null) => void }> = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      requests.push({ signal, resolve: (found) => resolve({ ok: true, json: async () => ({ video: found }) }) });
    })));
    return requests;
  }
  it("finishes slower and queued lookups as each result updates the live plan", async () => {
    const requests = pendingLookups();
    const initial = plan();
    initial.cooldown = [exercise("c1", "Hip stretch"), exercise("c2", "Calf stretch")];
    await act(async () => root.render(<UpdatingPlan initial={initial} />));
    expect(requests).toHaveLength(3);
    await act(async () => requests[0].resolve(null));
    // Completing the warm-up must not cancel the main exercise or cooldown.
    expect(requests[1].signal.aborted).toBe(false);
    expect(requests).toHaveLength(4);
    await act(async () => { for (const request of requests.slice(1)) request.resolve(video); });
    const found = JSON.parse(container.querySelector("output")!.textContent!) as Array<{ id: string; video?: ExerciseVideo | null }>;
    expect(found.map((e) => e.video)).toEqual([null, video, video, null, video, video]);
  });
  it("keeps uncached lookups running when a cached result updates the plan", async () => {
    localStorage.setItem("personalos:workout:videos", JSON.stringify({ "goblet squat": video }));
    const requests = pendingLookups();
    await act(async () => root.render(<UpdatingPlan initial={plan()} />));
    expect(requests).toHaveLength(1);
    expect(requests[0].signal.aborted).toBe(false);
    await act(async () => requests[0].resolve(video));
    const found = JSON.parse(container.querySelector("output")!.textContent!) as Array<{ video?: ExerciseVideo | null }>;
    expect(found.map((e) => e.video)).toEqual([video, video, video, null]);
  });
  it("restarts lookups after Strict Mode's effect cleanup", async () => {
    const requests = pendingLookups();
    const onVideo = vi.fn();
    await act(async () => root.render(<StrictMode><Probe plan={plan()} onVideo={onVideo} /></StrictMode>));
    const active = requests.filter((r) => !r.signal.aborted);
    expect(active).toHaveLength(2);
    await act(async () => { for (const request of active) request.resolve(video); });
    expect(onVideo.mock.calls).toEqual([["w1", video], ["m1", video], ["m2", video]]);
  });
  it("asks once per movement, applies the answer to every exercise sharing it, and skips ones already decided", async () => {
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({ video: url.includes("Goblet") ? video : null }),
    }));
    vi.stubGlobal("fetch", fetch);
    const onVideo = vi.fn();
    await act(async () => root.render(<Probe plan={plan()} onVideo={onVideo} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const urls = fetch.mock.calls.map((c) => decodeURIComponent(String(c[0])));
    expect(urls).toEqual(["/api/workout/video?name=Arm+circles&equipment=kettlebell", "/api/workout/video?name=Goblet+Squat&equipment=kettlebell"]);
    expect(onVideo.mock.calls).toEqual([["w1", null], ["m1", video], ["m2", video]]);
    expect(JSON.parse(localStorage.getItem("personalos:workout:videos")!)).toEqual({ "goblet squat": video });
  });
  it("serves a remembered movement without the network, and leaves a failed lookup for next time", async () => {
    localStorage.setItem("personalos:workout:videos", JSON.stringify({ "goblet squat": video }));
    const fetch = vi.fn(async (_url: string) => ({ ok: false, status: 502, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetch);
    const onVideo = vi.fn();
    await act(async () => root.render(<Probe plan={plan()} onVideo={onVideo} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onVideo.mock.calls).toEqual([["m1", video], ["m2", video]]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(String(fetch.mock.calls[0][0]))).toContain("name=Arm+circles");
  });
});

describe("ExerciseVideoEmbed", () => {
  it("shows a thumbnail and only loads the player on tap, with a link out", async () => {
    await act(async () => root.render(<ExerciseVideoEmbed video={video} name="Goblet Squat" />));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(container.textContent).toContain("Goblet Squat Form · Coach A");
    expect(container.querySelector("a")!.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Play Goblet Squat demonstration"]')!.click());
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1");
    expect(frame.getAttribute("title")).toBe("Goblet Squat demonstration: Goblet Squat Form");
  });
  it("stays folded in the player until asked", async () => {
    await act(async () => root.render(<ExerciseVideoToggle video={video} name="Goblet Squat" />));
    expect(container.querySelector("img")).toBeNull();
    const toggle = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Watch how"))!;
    await act(async () => toggle.click());
    expect(container.querySelector("img")).not.toBeNull();
    expect(toggle.textContent).toContain("Hide video");
  });
});
