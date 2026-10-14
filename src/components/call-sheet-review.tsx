"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Sheet } from "@/components/dating/sheet";
import type { CallSheetReview as Review, CallSheetReviewDecision, CallSheetReviewPerson } from "@/lib/call-sheet/types";

const actionClass = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm hover:bg-[var(--color-accent)] disabled:opacity-50";
const kbdClass = "rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted-foreground)]";
const KEEP = [{ key: "1", days: 30, label: "Monthly" }, { key: "2", days: 90, label: "Every 3 months" }, { key: "3", days: 180, label: "Twice a year" }, { key: "4", days: 365, label: "Yearly" }] as const;
export function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase(); }
type Step = { index: number; personId: string; kind: "keep" | "hide" | "skip" };
type Save = { index: number; body: CallSheetReviewDecision };

/** One person at a time. Choices advance at once; saves go out strictly in order. */
export function CallSheetReview({ count, onClose, onChanged }: { count: number; onClose: () => void; onChanged: () => void }) {
  const [people, setPeople] = useState<CallSheetReviewPerson[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const index = useRef(0), history = useRef<Step[]>([]), queue = useRef<Save[]>([]), running = useRef(false);
  const idle = useRef<(() => void)[]>([]), decided = useRef(false), alive = useRef(true);
  const load = useCallback(async () => {
    setLoadError(null); setPeople(null);
    try {
      const res = await fetch("/api/call-sheet/review", { cache: "no-store" });
      const result = (await res.json()) as Review;
      if (!res.ok || !Array.isArray(result.people)) throw Error(res.status === 401 ? "Sign in again to review." : "The review could not load. Try again.");
      if (!alive.current) return;
      index.current = 0; history.current = []; setPeople(result.people);
    } catch (e) {
      if (alive.current) setLoadError(e instanceof Error && e.message ? e.message : "The review could not load. Try again.");
    }
  }, []);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  // A failed save puts that person back in front and drops later unsent choices.
  // Undo resets stay queued so an undone choice is still undone on the server.
  function fail(save: Save, message: string) {
    queue.current = queue.current.filter(item => item.body.decision === "reset");
    index.current = Math.min(index.current, save.index);
    history.current = history.current.filter(step => step.index < index.current);
    if (alive.current) { setError(message); rerender(); }
  }
  async function pump() {
    if (running.current) return;
    running.current = true;
    while (queue.current.length) {
      const save = queue.current.shift()!;
      try {
        const res = await fetch("/api/call-sheet/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(save.body) });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || !result.ok) throw Error(typeof result.error === "string" ? result.error : res.status === 401 ? "Sign in again to save your review." : "That choice could not save. Try again.");
      } catch (e) {
        fail(save, e instanceof Error && e.message ? e.message : "That choice could not save. Try again.");
      }
    }
    running.current = false;
    for (const done of idle.current.splice(0)) done();
  }
  function enqueue(save: Save) { queue.current.push(save); void pump(); }
  function decide(kind: Step["kind"], cadenceDays?: number) {
    const person = people?.[index.current];
    if (!person) return;
    setError(null);
    history.current.push({ index: index.current, personId: person.personId, kind });
    if (kind !== "skip") {
      decided.current = true;
      enqueue({ index: index.current, body: kind === "keep" ? { personId: person.personId, decision: "keep", cadenceDays: cadenceDays! } : { personId: person.personId, decision: "hide" } });
    }
    index.current += 1; rerender();
  }
  function undo() {
    const step = history.current.pop();
    if (!step) return;
    setError(null);
    index.current = step.index;
    if (step.kind !== "skip") enqueue({ index: step.index, body: { personId: step.personId, decision: "reset" } });
    rerender();
  }
  function close() {
    onClose();
    if (!decided.current) return;
    if (running.current) idle.current.push(onChanged);
    else onChanged();
  }
  const keys = useRef({ decide, undo });
  keys.current = { decide, undo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const keep = KEEP.find(option => option.key === key);
      if (keep) keys.current.decide("keep", keep.days);
      else if (key === "x") keys.current.decide("hide");
      else if (key === "s" || key === "ArrowRight") keys.current.decide("skip");
      else if (key === "z") keys.current.undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const person = people?.[index.current];
  const details = person ? [person.company, person.role, person.city].filter(Boolean).join(" · ") : "";
  const labels = person ? [...person.circles, ...person.tags] : [];
  return (
    <Sheet title="Quick review" onClose={close}>
      <div data-overlay className="px-4 pb-4 pt-2">
        {loadError ? <div role="alert" className="rounded-lg bg-[var(--color-muted)] p-3 text-sm">{loadError} <button onClick={() => void load()} className="underline underline-offset-2">Retry</button></div> : null}
        {!people && !loadError ? <p role="status" className="py-3 text-sm text-[var(--color-muted-foreground)]">Getting {count === 1 ? "1 person" : `${count} people`} to review…</p> : null}
        {error ? <p role="alert" className="mb-3 rounded-lg bg-[var(--color-muted)] p-3 text-sm">{error}</p> : null}
        {people && !person ? <div className="py-3">
          <p className="text-sm">All caught up.</p>
          {history.current.length ? <button className={actionClass + " mt-2 -ml-3"} onClick={undo}><kbd className={kbdClass}>Z</kbd>Undo</button> : null}
        </div> : null}
        {person ? <>
          <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">{index.current + 1} of {people!.length} · No contact on record. How often should you check in?</p>
          <div className="flex items-start gap-3" data-person-id={person.personId}>
            {person.imageUrl ? <img src={person.imageUrl} alt="" className="size-12 shrink-0 rounded-full object-cover" /> : <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--color-muted)] text-sm text-[var(--color-muted-foreground)]">{initials(person.name)}</span>}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">{person.name}</p>
              {details ? <p className="text-sm text-[var(--color-muted-foreground)]">{details}</p> : null}
              {person.howWeMet ? <p className="text-sm">Met: {person.howWeMet}</p> : null}
              {person.strength ? <p className="text-xs text-[var(--color-muted-foreground)]">Strength · {person.strength}</p> : null}
              {labels.length ? <p className="text-xs text-[var(--color-muted-foreground)]">{labels.join(" · ")}</p> : null}
              {person.summary ? <p className="text-sm">{person.summary}</p> : null}
              {!person.reachable ? <p className="text-xs text-[var(--color-muted-foreground)]">No phone or email on file</p> : null}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {KEEP.map(option => <button key={option.key} type="button" className={actionClass + " min-h-12 justify-start border border-[var(--color-border)]"} onClick={() => decide("keep", option.days)}><kbd className={kbdClass}>{option.key}</kbd>{option.label}</button>)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" className={actionClass} onClick={() => decide("hide")}><kbd className={kbdClass}>X</kbd>Don’t suggest</button>
            <button type="button" className={actionClass} onClick={() => decide("skip")}><kbd className={kbdClass}>S</kbd>Skip</button>
            <button type="button" className={actionClass} disabled={!history.current.length} onClick={undo}><kbd className={kbdClass}>Z</kbd>Undo</button>
          </div>
        </> : null}
      </div>
    </Sheet>
  );
}
