"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import { compressImage } from "@/lib/image-compress";
import { haptic } from "@/lib/haptic";
import { PageHeader } from "@/components/mobile-chrome";
import {
  FOCUS_OPTIONS,
  INTENSITY_OPTIONS,
  estimatePlanMinutes,
  flattenPlan,
  formatClock,
  type EquipmentItem,
  type Exercise,
  type Focus,
  type Intensity,
  type PlanResponse,
  type SetLog,
  type Step,
  type WorkoutPlan,
  type WorkoutSession,
} from "@/lib/workout";
import { ExerciseFigure, propForEquipment } from "./exercise-figure";
import { MuscleMap } from "./muscle-map";
import { beep, unlockAudio, useCountdownCues, useNow, useWakeLock } from "./workout-timer";

// ---- localStorage ----------------------------------------------------------
// Everything lives client-side: the in-progress session (survives iOS killing
// the PWA mid-set), the equipment profile (so day 2 needs no photos), prefs
// and a short history for variety hints + the summary list.

const KEYS = {
  session: "personalos:workout:session",
  equipment: "personalos:workout:equipment",
  history: "personalos:workout:history",
  prefs: "personalos:workout:prefs",
} as const;

type Prefs = { minutes: number; focus: Focus; intensity: Intensity };
type HistoryEntry = {
  id: string;
  title: string;
  focus: Focus;
  startedAt: number;
  finishedAt: number;
  durationMin: number;
  setsLogged: number;
  loggedToPersonal: boolean;
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

const MINUTE_OPTIONS = [15, 20, 30, 45, 60] as const;
const FOCUS_LABEL: Record<Focus, string> = {
  "full-body": "Full body",
  upper: "Upper",
  lower: "Lower",
  push: "Push",
  pull: "Pull",
  core: "Core",
  conditioning: "Conditioning",
  mobility: "Mobility",
};

type Phase = "setup" | "plan" | "play" | "done";

export function WorkoutStudio() {
  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup");
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({ minutes: 30, focus: "full-body", intensity: "moderate" });
  const [proposal, setProposal] = useState<PlanResponse | null>(null);

  useEffect(() => {
    setSession(read<WorkoutSession | null>(KEYS.session, null));
    setEquipment(read<EquipmentItem[]>(KEYS.equipment, []));
    setHistory(read<HistoryEntry[]>(KEYS.history, []));
    setPrefs((p) => ({ ...p, ...read<Partial<Prefs>>(KEYS.prefs, {}) }));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) write(KEYS.session, session);
  }, [session, hydrated]);
  useEffect(() => {
    if (hydrated) write(KEYS.equipment, equipment);
  }, [equipment, hydrated]);
  useEffect(() => {
    if (hydrated) write(KEYS.history, history);
  }, [history, hydrated]);
  useEffect(() => {
    if (hydrated) write(KEYS.prefs, prefs);
  }, [prefs, hydrated]);

  const startSession = useCallback(
    (p: PlanResponse) => {
      unlockAudio();
      haptic("press");
      const s: WorkoutSession = {
        id: `w-${Date.now().toString(36)}`,
        plan: p.plan,
        equipment: p.equipment,
        startedAt: Date.now(),
        finishedAt: null,
        stepIndex: 0,
        logs: [],
        timerEndsAt: null,
        timerKind: null,
        timerPausedRemainingMs: null,
      };
      setSession(s);
      setPhase("play");
    },
    [],
  );

  const finishSession = useCallback(
    (s: WorkoutSession) => {
      const finishedAt = Date.now();
      const done = { ...s, finishedAt, timerEndsAt: null, timerKind: null, timerPausedRemainingMs: null };
      setSession(done);
      setHistory((h) =>
        [
          {
            id: s.id,
            title: s.plan.title,
            focus: s.plan.focus,
            startedAt: s.startedAt,
            finishedAt,
            durationMin: Math.max(1, Math.round((finishedAt - s.startedAt) / 60000)),
            setsLogged: s.logs.length,
            loggedToPersonal: false,
          },
          ...h.filter((e) => e.id !== s.id),
        ].slice(0, 30),
      );
      haptic("success");
      beep("done");
      setPhase("done");
    },
    [],
  );

  const discardSession = useCallback(() => {
    setSession(null);
    setProposal(null);
    setPhase("setup");
  }, []);

  if (!hydrated) {
    return (
      <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
        <PageHeader title="Workout" />
        <Header />
      </div>
    );
  }

  if (phase === "play" && session && !session.finishedAt) {
    return (
      <Player
        session={session}
        onChange={setSession}
        onFinish={() => finishSession(session)}
        onExit={() => setPhase("setup")}
      />
    );
  }

  if (phase === "done" && session?.finishedAt) {
    return (
      <Summary
        session={session}
        history={history}
        onHistoryChange={setHistory}
        onNew={discardSession}
      />
    );
  }

  if (phase === "plan" && proposal) {
    return (
      <PlanReview
        proposal={proposal}
        onBack={() => setPhase("setup")}
        onStart={() => {
          // Merge what Claude saw into the saved equipment profile.
          setEquipment((prev) => mergeEquipment(prev, proposal.equipment));
          startSession(proposal);
        }}
      />
    );
  }

  return (
    <Setup
      prefs={prefs}
      onPrefs={setPrefs}
      equipment={equipment}
      onEquipment={setEquipment}
      history={history}
      resumable={session && !session.finishedAt ? session : null}
      onResume={() => {
        unlockAudio();
        setPhase("play");
      }}
      onDiscardResumable={() => setSession(null)}
      onPlan={(p) => {
        setProposal(p);
        setPhase("plan");
      }}
    />
  );
}

function mergeEquipment(prev: EquipmentItem[], next: EquipmentItem[]): EquipmentItem[] {
  const out = [...prev];
  const seen = new Set(prev.map((e) => e.name.toLowerCase()));
  for (const e of next) {
    if (!seen.has(e.name.toLowerCase())) {
      out.push(e);
      seen.add(e.name.toLowerCase());
    }
  }
  return out.slice(0, 40);
}

function Header({ sub }: { sub?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-large-title font-bold">Workout</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        {sub ?? "Snap your equipment. Get a session built for it. Follow along with a timer and rep log."}
      </p>
    </header>
  );
}

// ---- Setup ------------------------------------------------------------------

function Setup({
  prefs,
  onPrefs,
  equipment,
  onEquipment,
  history,
  resumable,
  onResume,
  onDiscardResumable,
  onPlan,
}: {
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
  equipment: EquipmentItem[];
  onEquipment: (e: EquipmentItem[]) => void;
  history: HistoryEntry[];
  resumable: WorkoutSession | null;
  onResume: () => void;
  onDiscardResumable: () => void;
  onPlan: (p: PlanResponse) => void;
}) {
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [useSaved, setUseSaved] = useState<Set<string>>(() => new Set(equipment.map((e) => e.name)));
  const [newItem, setNewItem] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUseSaved(new Set(equipment.map((e) => e.name)));
  }, [equipment]);

  useEffect(() => {
    return () => photos.forEach((p) => URL.revokeObjectURL(p.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const files = Array.from(list).slice(0, 6 - photos.length);
    const next: { file: File; url: string }[] = [];
    for (const f of files) {
      try {
        const c = await compressImage(f);
        next.push({ file: c, url: URL.createObjectURL(c) });
      } catch {
        setError("Couldn't read one of those photos.");
      }
    }
    setPhotos((p) => [...p, ...next].slice(0, 6));
    if (inputRef.current) inputRef.current.value = "";
  }

  function removePhoto(i: number) {
    setPhotos((p) => {
      URL.revokeObjectURL(p[i].url);
      return p.filter((_, j) => j !== i);
    });
  }

  function addItem() {
    const name = newItem.trim();
    if (!name) return;
    if (!equipment.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      onEquipment([...equipment, { name }]);
    }
    setUseSaved((s) => new Set(s).add(name));
    setNewItem("");
  }

  const selected = equipment.filter((e) => useSaved.has(e.name));
  const canSubmit = photos.length > 0 || selected.length > 0 || notes.trim().length > 0;

  async function submit() {
    if (!canSubmit || busy) return;
    setError(null);
    setBusy(photos.length ? "Looking at your equipment…" : "Designing the session…");
    haptic("press");
    const form = new FormData();
    photos.forEach((p) => form.append("photos", p.file, p.file.name));
    form.set("minutes", String(prefs.minutes));
    form.set("focus", prefs.focus);
    form.set("intensity", prefs.intensity);
    form.set("notes", notes);
    form.set("knownEquipment", JSON.stringify(selected));
    form.set(
      "recentTitles",
      history
        .slice(0, 6)
        .map((h) => `${new Date(h.finishedAt).toISOString().slice(0, 10)} · ${h.title} (${FOCUS_LABEL[h.focus]}, ${h.durationMin} min)`)
        .join("\n"),
    );
    const slow = window.setTimeout(() => setBusy("Writing sets, reps and cues…"), 9000);
    try {
      const res = await fetch("/api/workout/plan", { method: "POST", body: form });
      const data = (await res.json()) as PlanResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`);
      haptic("success");
      onPlan(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      window.clearTimeout(slow);
      setBusy(null);
    }
  }

  return (
    <div className="px-4 py-4 pb-28 sm:px-6 md:px-8 md:py-6 max-w-2xl">
      <PageHeader title="Workout" />
      <Header />

      {resumable && (
        <section className="mb-6 rounded-2xl border border-[var(--color-tint)]/40 bg-[var(--color-card)] p-4 animate-fade-in-up">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-tint)]">In progress</div>
              <div className="mt-0.5 font-semibold">{resumable.plan.title}</div>
              <div className="text-sm text-[var(--color-muted-foreground)]">
                {resumable.logs.length} sets logged · started {relTime(resumable.startedAt)}
              </div>
            </div>
            <button
              onClick={onDiscardResumable}
              className="rounded-full p-1.5 text-[var(--color-label-tertiary)] hover:bg-[var(--color-fill)]"
              aria-label="Discard in-progress workout"
            >
              <X className="size-4" />
            </button>
          </div>
          <button onClick={onResume} className={btnPrimary + " mt-3 w-full"}>
            <Play className="size-4" /> Resume
          </button>
        </section>
      )}

      {/* Photos */}
      <section className="mb-6">
        <SectionLabel>Equipment photos</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <div key={p.url} className="relative aspect-square overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-fill)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="h-full w-full object-cover" />
              <button
                onClick={() => removePhoto(i)}
                aria-label="Remove photo"
                className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {photos.length < 6 && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] active:bg-[var(--color-fill)]">
              <Camera className="size-6" />
              <span className="text-xs">{photos.length ? "Add" : "Camera / library"}</span>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => void addFiles(e.target.files)}
              />
            </label>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--color-label-tertiary)]">
          Dumbbell racks, benches, bands, machines, a hotel gym — up to 6 photos. Photos aren&apos;t stored.
        </p>
      </section>

      {/* Saved equipment */}
      <section className="mb-6">
        <SectionLabel>Saved equipment {equipment.length ? `· ${selected.length} of ${equipment.length} selected` : ""}</SectionLabel>
        {equipment.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {equipment.map((e) => {
              const on = useSaved.has(e.name);
              return (
                <button
                  key={e.name}
                  onClick={() => {
                    haptic("tick");
                    setUseSaved((s) => {
                      const n = new Set(s);
                      if (n.has(e.name)) n.delete(e.name);
                      else n.add(e.name);
                      return n;
                    });
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    onEquipment(equipment.filter((x) => x.name !== e.name));
                  }}
                  className={chip(on)}
                  title={e.detail ?? e.name}
                >
                  {on && <Check className="size-3" />}
                  {e.name}
                  {e.detail && <span className="opacity-60"> · {e.detail}</span>}
                </button>
              );
            })}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addItem();
          }}
          className="flex gap-2"
        >
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder={equipment.length ? "Add an item…" : "Or type it: 2×25 lb dumbbells, pull-up bar, bands"}
            className={input}
          />
          <button type="submit" className={btnSecondary} disabled={!newItem.trim()}>
            <Plus className="size-4" />
          </button>
        </form>
        {equipment.length > 0 && (
          <p className="mt-1.5 text-xs text-[var(--color-label-tertiary)]">
            Equipment Claude spots in your photos is saved here. Long-press a chip to remove it.
          </p>
        )}
      </section>

      {/* Prefs */}
      <section className="mb-6 space-y-4">
        <div>
          <SectionLabel>Time</SectionLabel>
          <Segmented
            options={MINUTE_OPTIONS.map((m) => ({ value: String(m), label: `${m}m` }))}
            value={String(prefs.minutes)}
            onChange={(v) => onPrefs({ ...prefs, minutes: Number(v) })}
          />
        </div>
        <div>
          <SectionLabel>Focus</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {FOCUS_OPTIONS.map((f) => (
              <button key={f} onClick={() => { haptic("tick"); onPrefs({ ...prefs, focus: f }); }} className={chip(prefs.focus === f)}>
                {FOCUS_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel>Intensity</SectionLabel>
          <Segmented
            options={INTENSITY_OPTIONS.map((i) => ({ value: i, label: i[0].toUpperCase() + i.slice(1) }))}
            value={prefs.intensity}
            onChange={(v) => onPrefs({ ...prefs, intensity: v as Intensity })}
          />
        </div>
        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Sore hamstrings, skip jumping, want to hit shoulders, hotel gym…"
            className={input + " resize-none"}
          />
        </div>
      </section>

      {error && (
        <p className="mb-3 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      )}

      <button onClick={() => void submit()} disabled={!canSubmit || !!busy} className={btnPrimary + " w-full py-3 text-base"}>
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> {busy}
          </>
        ) : (
          <>
            <Dumbbell className="size-4" /> Build my workout
          </>
        )}
      </button>

      {history.length > 0 && (
        <section className="mt-8">
          <SectionLabel>Recent</SectionLabel>
          <ul className="divide-y divide-[var(--color-separator)] rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
            {history.slice(0, 6).map((h) => (
              <li key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{h.title}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    {new Date(h.finishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {FOCUS_LABEL[h.focus]} · {h.setsLogged} sets
                  </div>
                </div>
                <div className="shrink-0 tabular-nums text-[var(--color-muted-foreground)]">{h.durationMin} min</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---- Plan review -----------------------------------------------------------

function PlanReview({
  proposal,
  onBack,
  onStart,
}: {
  proposal: PlanResponse;
  onBack: () => void;
  onStart: () => void;
}) {
  const { plan, equipment } = proposal;
  const steps = useMemo(() => flattenPlan(plan), [plan]);
  const est = estimatePlanMinutes(plan);
  return (
    <div className="px-4 py-4 pb-28 sm:px-6 md:px-8 md:py-6 max-w-2xl animate-fade-in-up">
      <PageHeader title="Your workout" />
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)]">
        <ChevronLeft className="size-4" /> Back
      </button>
      <header className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-tint)]">{FOCUS_LABEL[plan.focus]}</div>
        <h1 className="text-large-title font-bold">{plan.title}</h1>
        {plan.summary && <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{plan.summary}</p>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-label-secondary)]">
          <span>~{Math.max(est, plan.estimatedMinutes)} min</span>
          <span>{steps.length} sets</span>
          <span>{plan.warmup.length + plan.blocks.reduce((n, b) => n + b.exercises.length, 0) + plan.cooldown.length} exercises</span>
        </div>
      </header>

      {equipment.length > 0 && (
        <section className="mb-5">
          <SectionLabel>Equipment spotted</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {equipment.map((e) => (
              <span key={e.name} className={chip(false) + " cursor-default"} title={e.detail}>
                {e.name}
                {e.detail && <span className="opacity-60"> · {e.detail}</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {plan.warmup.length > 0 && <ExerciseSection title="Warm-up" exercises={plan.warmup} />}
      {plan.blocks.map((b) => (
        <ExerciseSection
          key={b.name}
          title={b.name}
          badge={b.type !== "straight" ? b.type : undefined}
          exercises={b.exercises}
        />
      ))}
      {plan.cooldown.length > 0 && <ExerciseSection title="Cool-down" exercises={plan.cooldown} />}

      <div className="mt-6 flex gap-2">
        <button onClick={onBack} className={btnSecondary + " flex-1 py-3"}>
          <RefreshCw className="size-4" /> Rebuild
        </button>
        <button onClick={onStart} className={btnPrimary + " flex-[2] py-3 text-base"}>
          <Play className="size-4" /> Start workout
        </button>
      </div>
    </div>
  );
}

function ExerciseSection({ title, badge, exercises }: { title: string; badge?: string; exercises: Exercise[] }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel className="mb-0">{title}</SectionLabel>
        {badge && (
          <span className="rounded-full bg-[var(--color-fill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-label-secondary)]">
            {badge}
          </span>
        )}
      </div>
      <ul className="divide-y divide-[var(--color-separator)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
        {exercises.map((e) => (
          <ExerciseRow key={e.id} exercise={e} />
        ))}
      </ul>
    </section>
  );
}

function ExerciseRow({ exercise: e }: { exercise: Exercise }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-[var(--color-fill)]">
        <div className="size-14 shrink-0 rounded-lg bg-[var(--color-fill-secondary)]">
          <ExerciseFigure pattern={e.pattern} playing={open} prop={propForEquipment(e.equipment, e.load)} className="h-full w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{e.name}</div>
          <div className="text-sm text-[var(--color-muted-foreground)]">
            {prescription(e)} · {e.load}
          </div>
        </div>
        <ChevronRight className={`size-4 shrink-0 text-[var(--color-label-tertiary)] transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="flex gap-3 border-t border-[var(--color-separator)] bg-[var(--color-fill-secondary)]/60 px-3 py-3 animate-fade-in-up">
          <div className="min-w-0 flex-1">
            {e.cues.length > 0 && (
              <ul className="space-y-1 text-sm">
                {e.cues.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span className="text-[var(--color-tint)]">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {e.muscles.map((m) => (
                <span key={m} className="rounded-full bg-[var(--color-fill)] px-2 py-0.5 text-[11px] text-[var(--color-label-secondary)]">
                  {m.replace("-", " ")}
                </span>
              ))}
              {e.restSec > 0 && (
                <span className="rounded-full bg-[var(--color-fill)] px-2 py-0.5 text-[11px] text-[var(--color-label-secondary)]">
                  rest {e.restSec}s
                </span>
              )}
            </div>
          </div>
          <MuscleMap muscles={e.muscles} className="h-24 shrink-0" />
        </div>
      )}
    </li>
  );
}

function prescription(e: Exercise): string {
  const side = e.perSide ? " each side" : "";
  if (e.durationSec !== null) return `${e.sets} × ${e.durationSec}s${side}`;
  return `${e.sets} × ${e.reps}${side}`;
}

// ---- Player ----------------------------------------------------------------

function Player({
  session,
  onChange,
  onFinish,
  onExit,
}: {
  session: WorkoutSession;
  onChange: (s: WorkoutSession) => void;
  onFinish: () => void;
  onExit: () => void;
}) {
  const steps = useMemo(() => flattenPlan(session.plan), [session.plan]);
  const idx = Math.min(session.stepIndex, steps.length - 1);
  const step = steps[idx];
  const next = steps[idx + 1] ?? null;
  const e = step.exercise;
  const timerRunning = session.timerEndsAt !== null && session.timerPausedRemainingMs === null;
  const now = useNow(true, timerRunning ? 200 : 1000);
  useWakeLock(true);

  const remainingMs =
    session.timerPausedRemainingMs !== null
      ? session.timerPausedRemainingMs
      : session.timerEndsAt !== null
        ? session.timerEndsAt - now
        : null;
  const remainingSec = remainingMs === null ? null : Math.max(0, remainingMs / 1000);

  const [reps, setReps] = useState<number>(e.reps ?? 0);
  const [load, setLoad] = useState<string>(e.load);
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => {
    setReps(e.reps ?? 0);
    setLoad(e.load);
  }, [e.id, e.reps, e.load, step.setIndex]);

  const onCue = useCallback((s: number) => {
    if (s === 0) return; // handled by the completion effect
    beep("tick");
    haptic("tick");
  }, []);
  useCountdownCues(remainingSec, onCue);

  // Timer completion: a "work" timer logs the set and rolls into rest; a
  // "rest" timer just clears. Both are wall-clock driven so a suspended tab
  // resolves correctly on return.
  const completedRef = useRef<number | null>(null);
  useEffect(() => {
    if (session.timerEndsAt === null || session.timerPausedRemainingMs !== null) return;
    if (now < session.timerEndsAt) return;
    if (completedRef.current === session.timerEndsAt) return;
    completedRef.current = session.timerEndsAt;
    beep("go");
    haptic("success");
    if (session.timerKind === "work") {
      logSet({ reps: null, durationSec: e.durationSec });
    } else {
      onChange({ ...session, timerEndsAt: null, timerKind: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, session.timerEndsAt, session.timerPausedRemainingMs]);

  function startTimer(kind: "work" | "rest", sec: number, base: WorkoutSession = session) {
    onChange({ ...base, timerKind: kind, timerEndsAt: Date.now() + sec * 1000, timerPausedRemainingMs: null });
  }

  function logSet(v: { reps: number | null; durationSec: number | null }) {
    const log: SetLog = {
      stepKey: step.key,
      exerciseId: e.id,
      exerciseName: e.name,
      setIndex: step.setIndex,
      reps: v.reps,
      durationSec: v.durationSec,
      load,
      completedAt: Date.now(),
    };
    const logs = [...session.logs.filter((l) => l.stepKey !== step.key), log];
    const isLast = idx >= steps.length - 1;
    if (isLast) {
      onChange({ ...session, logs, timerEndsAt: null, timerKind: null, timerPausedRemainingMs: null });
      onFinish();
      return;
    }
    const advanced: WorkoutSession = { ...session, logs, stepIndex: idx + 1, timerEndsAt: null, timerKind: null, timerPausedRemainingMs: null };
    if (step.restSec > 0) startTimer("rest", step.restSec, advanced);
    else onChange(advanced);
  }

  function go(delta: number) {
    haptic("tick");
    const target = Math.max(0, Math.min(steps.length - 1, idx + delta));
    onChange({ ...session, stepIndex: target, timerEndsAt: null, timerKind: null, timerPausedRemainingMs: null });
  }

  function togglePause() {
    haptic("tick");
    if (session.timerPausedRemainingMs !== null) {
      onChange({ ...session, timerEndsAt: Date.now() + session.timerPausedRemainingMs, timerPausedRemainingMs: null });
    } else if (session.timerEndsAt !== null) {
      onChange({ ...session, timerPausedRemainingMs: Math.max(0, session.timerEndsAt - Date.now()) });
    }
  }

  function extend(sec: number) {
    haptic("tick");
    if (session.timerPausedRemainingMs !== null) {
      onChange({ ...session, timerPausedRemainingMs: session.timerPausedRemainingMs + sec * 1000 });
    } else if (session.timerEndsAt !== null) {
      onChange({ ...session, timerEndsAt: session.timerEndsAt + sec * 1000 });
    }
  }

  const resting = session.timerKind === "rest" && remainingSec !== null;
  const working = session.timerKind === "work" && remainingSec !== null;
  const elapsed = Math.floor((now - session.startedAt) / 1000);
  const progress = (idx + (resting ? 1 : 0)) / steps.length;
  const logged = session.logs.some((l) => l.stepKey === step.key);

  return (
    <div className="flex min-h-[calc(100dvh-48px-env(safe-area-inset-top))] flex-col px-4 py-3 pb-24 sm:px-6 md:min-h-0 md:max-w-2xl md:px-8 md:py-6">
      <PageHeader title={session.plan.title} />
      {/* Top bar */}
      <div className="mb-3 flex items-center justify-between text-xs text-[var(--color-muted-foreground)]">
        <button onClick={onExit} className="inline-flex items-center gap-1">
          <ChevronLeft className="size-4" /> Leave
        </button>
        <div className="font-medium uppercase tracking-wide">
          {step.section === "main" ? step.blockName : step.section === "warmup" ? "Warm-up" : "Cool-down"}
        </div>
        <div className="tabular-nums">{formatClock(elapsed)}</div>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-[var(--color-fill)]">
        <div className="h-full rounded-full bg-[var(--color-tint)] transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      {resting ? (
        <RestCard
          remainingSec={remainingSec!}
          totalSec={Math.max(1, steps[idx - 1]?.restSec ?? step.restSec)}
          paused={session.timerPausedRemainingMs !== null}
          nextStep={step}
          onSkip={() => {
            haptic("tick");
            onChange({ ...session, timerEndsAt: null, timerKind: null, timerPausedRemainingMs: null });
          }}
          onExtend={() => extend(15)}
          onPause={togglePause}
        />
      ) : (
        <div className="flex flex-1 flex-col animate-fade-in-up" key={step.key}>
          {/* Exercise card */}
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div className="flex items-start gap-3">
              <div className="h-36 w-36 shrink-0 rounded-xl bg-[var(--color-fill-secondary)] sm:h-44 sm:w-44">
                <ExerciseFigure pattern={e.pattern} playing prop={propForEquipment(e.equipment, e.load)} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-tint)]">
                  Set {step.setIndex + 1} of {step.setCount}
                  {step.blockType !== "straight" && ` · ${step.blockType}`}
                </div>
                <h2 className="mt-0.5 text-xl font-bold leading-tight">{e.name}</h2>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {e.durationSec !== null ? `${e.durationSec}s` : `${e.reps} reps`}
                  {e.perSide && <span className="text-sm font-normal text-[var(--color-muted-foreground)]"> each side</span>}
                </div>
                <div className="text-sm text-[var(--color-muted-foreground)]">{e.load}</div>
                <MuscleMap muscles={e.muscles} className="mt-2 h-20 justify-start" />
              </div>
            </div>
            {e.cues.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-[var(--color-separator)] pt-3 text-sm">
                {e.cues.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span className="text-[var(--color-tint)]">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Work controls */}
          <div className="mt-4">
            {e.durationSec !== null ? (
              working ? (
                <div className="flex flex-col items-center">
                  <Ring value={1 - remainingSec! / e.durationSec} label={formatClock(Math.ceil(remainingSec!))} sub="hold" />
                  <div className="mt-3 flex gap-2">
                    <button onClick={togglePause} className={btnSecondary}>
                      {session.timerPausedRemainingMs !== null ? <Play className="size-4" /> : <Pause className="size-4" />}
                      {session.timerPausedRemainingMs !== null ? "Resume" : "Pause"}
                    </button>
                    <button onClick={() => logSet({ reps: null, durationSec: e.durationSec })} className={btnSecondary}>
                      <Check className="size-4" /> Done early
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    unlockAudio();
                    haptic("press");
                    beep("go");
                    startTimer("work", e.durationSec!);
                  }}
                  className={btnPrimary + " w-full py-4 text-lg"}
                >
                  <Play className="size-5" /> Start {e.durationSec}s
                </button>
              )
            ) : (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-[var(--color-muted-foreground)]">Reps</div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { haptic("tick"); setReps((r) => Math.max(0, r - 1)); }} className={stepper} aria-label="Fewer reps">
                      <Minus className="size-5" />
                    </button>
                    <div className="w-14 text-center text-3xl font-bold tabular-nums">{reps}</div>
                    <button onClick={() => { haptic("tick"); setReps((r) => Math.min(200, r + 1)); }} className={stepper} aria-label="More reps">
                      <Plus className="size-5" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-sm text-[var(--color-muted-foreground)]">Load</div>
                  <input value={load} onChange={(ev) => setLoad(ev.target.value)} className={input + " max-w-[60%] text-right"} />
                </div>
                <button
                  onClick={() => {
                    unlockAudio();
                    haptic("press");
                    logSet({ reps, durationSec: null });
                  }}
                  className={btnPrimary + " mt-3 w-full py-4 text-lg"}
                >
                  <Check className="size-5" /> {logged ? "Update set" : "Log set"}
                  {step.restSec > 0 && idx < steps.length - 1 && <span className="text-sm font-normal opacity-80"> · rest {step.restSec}s</span>}
                </button>
              </div>
            )}
          </div>

          {/* Nav */}
          <div className="mt-4 flex items-center justify-between text-sm">
            <button onClick={() => go(-1)} disabled={idx === 0} className={btnGhost}>
              <ChevronLeft className="size-4" /> Prev
            </button>
            <div className="text-xs text-[var(--color-muted-foreground)]">
              {next ? `Next: ${next.exercise.name}` : "Last set"}
            </div>
            <button onClick={() => go(1)} disabled={idx >= steps.length - 1} className={btnGhost}>
              Skip <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-center">
        {confirmEnd ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--color-muted-foreground)]">End the workout?</span>
            <button onClick={onFinish} className={btnDanger}>
              End
            </button>
            <button onClick={() => setConfirmEnd(false)} className={btnGhost}>
              Keep going
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmEnd(true)} className={btnGhost + " text-[var(--color-muted-foreground)]"}>
            <Square className="size-3.5" /> End workout
          </button>
        )}
      </div>
    </div>
  );
}

function RestCard({
  remainingSec,
  totalSec,
  paused,
  nextStep,
  onSkip,
  onExtend,
  onPause,
}: {
  remainingSec: number;
  totalSec: number;
  paused: boolean;
  nextStep: Step;
  onSkip: () => void;
  onExtend: () => void;
  onPause: () => void;
}) {
  const e = nextStep.exercise;
  return (
    <div className="flex flex-1 flex-col items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 animate-scale-in">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Rest</div>
      <Ring value={1 - remainingSec / totalSec} label={formatClock(Math.ceil(remainingSec))} sub={paused ? "paused" : "seconds"} big />
      <div className="mt-3 flex gap-2">
        <button onClick={onExtend} className={btnSecondary}>
          <Plus className="size-4" /> 15s
        </button>
        <button onClick={onPause} className={btnSecondary}>
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={onSkip} className={btnPrimary + " whitespace-nowrap"}>
          Skip <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="mt-6 w-full border-t border-[var(--color-separator)] pt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-tint)]">
          Up next · set {nextStep.setIndex + 1} of {nextStep.setCount}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <div className="size-16 shrink-0 rounded-lg bg-[var(--color-fill-secondary)]">
            <ExerciseFigure pattern={e.pattern} playing prop={propForEquipment(e.equipment, e.load)} className="h-full w-full" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold">{e.name}</div>
            <div className="text-sm text-[var(--color-muted-foreground)]">
              {e.durationSec !== null ? `${e.durationSec}s` : `${e.reps} reps`}
              {e.perSide ? " each side" : ""} · {e.load}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ring({ value, label, sub, big }: { value: number; label: string; sub?: string; big?: boolean }) {
  const size = big ? 180 : 132;
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative mt-2" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-fill)" strokeWidth={8} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-tint)"
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          className="transition-[stroke-dashoffset] duration-200 ease-linear"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={`font-bold tabular-nums ${big ? "text-5xl" : "text-4xl"}`}>{label}</div>
        {sub && <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{sub}</div>}
      </div>
    </div>
  );
}

// ---- Summary ---------------------------------------------------------------

function Summary({
  session,
  history,
  onHistoryChange,
  onNew,
}: {
  session: WorkoutSession;
  history: HistoryEntry[];
  onHistoryChange: (h: HistoryEntry[]) => void;
  onNew: () => void;
}) {
  const entry = history.find((h) => h.id === session.id);
  const [logState, setLogState] = useState<"idle" | "busy" | "done" | "none" | "error">(entry?.loggedToPersonal ? "done" : "idle");
  const durationMin = Math.max(1, Math.round(((session.finishedAt ?? Date.now()) - session.startedAt) / 60000));
  const totalReps = session.logs.reduce((n, l) => n + (l.reps ?? 0), 0);
  const holdSec = session.logs.reduce((n, l) => n + (l.durationSec ?? 0), 0);
  const byExercise = useMemo(() => {
    const m = new Map<string, SetLog[]>();
    for (const l of session.logs) m.set(l.exerciseName, [...(m.get(l.exerciseName) ?? []), l]);
    return Array.from(m.entries());
  }, [session.logs]);

  async function logToPersonal() {
    setLogState("busy");
    const notes = byExercise
      .map(([name, logs]) => `${name}: ${logs.map((l) => (l.reps !== null ? `${l.reps}` : `${l.durationSec}s`)).join(", ")}${logs[0]?.load ? ` @ ${logs[0].load}` : ""}`)
      .join("\n");
    try {
      const res = await fetch("/api/workout/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: session.plan.title, startedAt: session.startedAt, durationMin, notes }),
      });
      const data = (await res.json()) as { logged?: boolean; reason?: string };
      if (!res.ok) throw new Error("failed");
      if (data.logged) {
        setLogState("done");
        onHistoryChange(history.map((h) => (h.id === session.id ? { ...h, loggedToPersonal: true } : h)));
        haptic("success");
      } else setLogState("none");
    } catch {
      setLogState("error");
    }
  }

  return (
    <div className="px-4 py-4 pb-28 sm:px-6 md:px-8 md:py-6 max-w-2xl animate-fade-in-up">
      <PageHeader title="Done" />
      <header className="mb-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-success)]">Workout complete</div>
        <h1 className="text-large-title font-bold">{session.plan.title}</h1>
      </header>
      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label="Minutes" value={String(durationMin)} />
        <Stat label="Sets" value={String(session.logs.length)} />
        <Stat label={holdSec && !totalReps ? "Hold" : "Reps"} value={holdSec && !totalReps ? formatClock(holdSec) : String(totalReps)} />
      </div>
      {byExercise.length > 0 && (
        <ul className="mb-6 divide-y divide-[var(--color-separator)] rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
          {byExercise.map(([name, logs]) => (
            <li key={name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{name}</div>
                <div className="text-xs text-[var(--color-muted-foreground)]">{logs[0]?.load}</div>
              </div>
              <div className="shrink-0 tabular-nums text-[var(--color-label-secondary)]">
                {logs.map((l) => (l.reps !== null ? l.reps : `${l.durationSec}s`)).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <button onClick={() => void logToPersonal()} disabled={logState === "busy" || logState === "done"} className={btnSecondary + " w-full py-3"}>
          {logState === "busy" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {logState === "done" ? "Logged to Personal" : logState === "none" ? "No health profile to log to" : logState === "error" ? "Couldn't log — try again" : "Log to Personal (fitness sessions)"}
        </button>
        <button onClick={onNew} className={btnPrimary + " w-full py-3"}>
          <Dumbbell className="size-4" /> New workout
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
    </div>
  );
}

// ---- Bits ------------------------------------------------------------------

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-label-secondary)] ${className ?? ""}`}>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-xl bg-[var(--color-fill)] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => {
            haptic("tick");
            onChange(o.value);
          }}
          className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors ${
            o.value === value ? "bg-[var(--color-elevated)] shadow-sm" : "text-[var(--color-label-secondary)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function relTime(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const chip = (on: boolean) =>
  `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors ${
    on
      ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-[var(--color-background)]"
      : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]"
  }`;
const input =
  "w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]/40";
const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-foreground)] px-4 py-2.5 font-semibold text-[var(--color-background)] transition-opacity active:opacity-80 disabled:opacity-40";
const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2.5 font-medium transition-colors active:bg-[var(--color-fill)] disabled:opacity-40";
const btnGhost = "inline-flex items-center gap-1 rounded-lg px-2 py-1.5 font-medium disabled:opacity-30";
const btnDanger = "inline-flex items-center gap-1 rounded-lg bg-[var(--color-destructive)] px-3 py-1.5 font-semibold text-white";
const stepper =
  "grid size-11 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] active:bg-[var(--color-fill)]";
