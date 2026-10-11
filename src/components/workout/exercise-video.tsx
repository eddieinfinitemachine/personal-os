"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { videoKey, type Exercise, type ExerciseVideo, type WorkoutPlan } from "@/lib/workout";

// A demo video for each exercise so the movement can be seen, not just read.
// The server finds one per exercise name; the answer rides along with the plan
// in localStorage, plus a small shared cache so repeat movements never ask twice.

const CACHE_KEY = "personalos:workout:videos";
const CACHE_MAX = 200;
const CONCURRENCY = 3;

function readCache(): Record<string, ExerciseVideo> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, ExerciseVideo>) : {};
  } catch {
    return {};
  }
}
function remember(key: string, video: ExerciseVideo) {
  try {
    const cache = readCache();
    delete cache[key];
    const entries = [...Object.entries(cache), [key, video] as const].slice(-CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* quota / private mode */
  }
}

export function planExercises(plan: WorkoutPlan): Exercise[] {
  return [...plan.warmup, ...plan.blocks.flatMap((b) => b.exercises), ...plan.cooldown];
}

/** The plan with one exercise's video set; the same object when nothing changes. */
export function withVideo(plan: WorkoutPlan, exerciseId: string, video: ExerciseVideo | null): WorkoutPlan {
  let changed = false;
  const patch = (list: Exercise[]) =>
    list.map((e) => {
      if (e.id !== exerciseId || e.video === video) return e;
      changed = true;
      return { ...e, video };
    });
  const next: WorkoutPlan = {
    ...plan,
    warmup: patch(plan.warmup),
    blocks: plan.blocks.map((b) => ({ ...b, exercises: patch(b.exercises) })),
    cooldown: patch(plan.cooldown),
  };
  return changed ? next : plan;
}

async function lookup(name: string, equipment: string, signal: AbortSignal): Promise<ExerciseVideo | null> {
  const params = new URLSearchParams({ name, equipment });
  const res = await fetch(`/api/workout/video?${params}`, { signal });
  if (!res.ok) throw new Error(`video lookup failed (${res.status})`);
  const data = (await res.json()) as { video?: ExerciseVideo | null };
  return data.video ?? null;
}

/**
 * Fill in `video` for every exercise on the plan that has not been looked up.
 * Each exercise is tried once per page load; a failed lookup stays undefined
 * so a later visit can try again.
 */
export function useExerciseVideos(plan: WorkoutPlan | null, onVideo: (exerciseId: string, video: ExerciseVideo | null) => void) {
  const attempted = useRef(new Set<string>());
  const latest = useRef(onVideo);
  latest.current = onVideo;
  useEffect(() => {
    if (!plan) return;
    const pending = planExercises(plan).filter((e) => e.video === undefined && !attempted.current.has(e.id));
    if (!pending.length) return;
    const controller = new AbortController();
    const cache = readCache();
    // One lookup per movement, applied to every exercise that shares it.
    const groups = new Map<string, Exercise[]>();
    for (const e of pending) {
      attempted.current.add(e.id);
      const key = videoKey(e.name);
      const hit = cache[key];
      if (hit) {
        onVideo(e.id, hit);
        continue;
      }
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const queue = [...groups.values()];
    const worker = async () => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        const [first] = group;
        try {
          const video = await lookup(first.name, first.equipment, controller.signal);
          if (controller.signal.aborted) return;
          if (video) remember(videoKey(first.name), video);
          for (const e of group) latest.current(e.id, video);
        } catch {
          if (controller.signal.aborted) return;
          for (const e of group) attempted.current.delete(e.id);
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    return () => controller.abort();
    // onVideo is read through a ref so a new callback never restarts lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
}

/** Tap-to-play YouTube demo: a thumbnail until tapped, then the player. */
export function ExerciseVideoEmbed({ video, name, className = "" }: { video: ExerciseVideo; name: string; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const watch = `https://www.youtube.com/watch?v=${video.youtubeId}`;
  return (
    <figure className={className} data-testid="exercise-video">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&rel=0&playsinline=1`}
            title={`${name} demonstration: ${video.title}`}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 h-full w-full"
            aria-label={`Play ${name} demonstration`}
          >
            <img
              src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid size-14 place-items-center rounded-full bg-black/70 text-white shadow-lg">
                <Play className="size-6 translate-x-0.5 fill-current" aria-hidden="true" />
              </span>
            </span>
          </button>
        )}
      </div>
      <figcaption className="mt-1.5 flex items-start justify-between gap-2 text-xs text-[var(--color-muted-foreground)]">
        <span className="min-w-0 truncate">
          {video.title}
          {video.channel ? ` · ${video.channel}` : ""}
        </span>
        <a href={watch} target="_blank" rel="noreferrer noopener" className="inline-flex shrink-0 items-center gap-1 hover:underline">
          YouTube <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}

/** Small "Watch" disclosure for the player, where the screen must stay focused. */
export function ExerciseVideoToggle({ video, name }: { video: ExerciseVideo; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t border-[var(--color-separator)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-[var(--color-tint)] hover:bg-[var(--color-fill)]"
      >
        <Play className="size-4 fill-current" aria-hidden="true" />
        {open ? "Hide video" : "Watch how it’s done"}
      </button>
      {open && <ExerciseVideoEmbed video={video} name={name} className="mt-2 animate-fade-in-up" />}
    </div>
  );
}
