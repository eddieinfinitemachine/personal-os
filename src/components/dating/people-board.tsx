"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Ellipsis, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, isStage, type Stage } from "@/lib/dating";
import { byActivity, byPastRelationship, matchesPersonName, relationshipDates, withStage } from "@/lib/dating-board";
import { initials } from "@/lib/initials";
import type { DatingPersonDTO } from "@/lib/dating-server";

export type DatingCard = DatingPersonDTO & {
  dateCount: number;
  avgVibe: number | null;
  /** Newest private photo, shown as a small round avatar. */
  avatarUrl: string | null;
  firstEventAt: string | null;
  lastEventAt: string | null;
  lastDate: { at: string; vibe: number | null } | null;
};

const ENDED_KEY = "personalos:dating-ended-open";
const LABEL: Record<Stage, string> = {
  talking: "Pursuing",
  dating: "Dating",
  exclusive: "Exclusive",
  paused: "Paused",
  ended: "Ended",
};

/** A people overview: current relationships first, past ones tucked below. */
export function PeopleBoard({ people }: { people: DatingCard[] }) {
  const router = useRouter();
  const pastId = useId();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const [endedOpen, setEndedOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [moved, setMoved] = useState<Record<string, Pick<DatingCard, "stage" | "endedAt">>>({});
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try { setEndedOpen(localStorage.getItem(ENDED_KEY) === "1"); } catch {}
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  const toggleEnded = () => {
    const next = !endedOpen;
    setEndedOpen(next);
    try { localStorage.setItem(ENDED_KEY, next ? "1" : "0"); } catch {}
  };
  const showToast = (text: string, error = true) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };
  const finish = (id: string) => {
    pending.current.delete(id);
    setBusy(new Set(pending.current));
  };

  const visible = people.filter((p) => !removed.has(p.id)).map((p) => ({ ...p, ...moved[p.id] }));
  const searching = query.trim().length > 0;
  const matches = visible.filter((p) => matchesPersonName(p.name, query));
  const current = matches.filter((p) => p.stage !== "ended").sort(byActivity);
  const past = matches.filter((p) => p.stage === "ended").sort(byPastRelationship);
  const clearSearch = () => {
    setQuery("");
    searchInput.current?.focus();
  };

  const move = async (id: string, stage: Stage) => {
    const p = visible.find((x) => x.id === id);
    if (!p || p.stage === stage || pending.current.has(id)) return;
    pending.current.add(id);
    setBusy(new Set(pending.current));
    const prev = moved[id];
    const optimistic = withStage(p, stage);
    setMoved((m) => ({ ...m, [id]: { stage: optimistic.stage, endedAt: optimistic.endedAt } }));
    try {
      const res = await fetch(`/api/dating/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.person) throw new Error("Status update failed");
      setMoved((m) => ({ ...m, [id]: { stage: data.person.stage, endedAt: data.person.endedAt } }));
      if (stage === "ended") showToast(`${p.name} moved to past relationships.`, false);
    } catch {
      setMoved((m) => {
        const next = { ...m };
        if (prev) next[id] = prev;
        else delete next[id];
        return next;
      });
      showToast(`Couldn't update ${p.name}. Please try again.`);
    } finally {
      finish(id);
    }
  };

  const remove = async (p: DatingCard) => {
    if (pending.current.has(p.id)) return;
    if (!confirm(`Delete ${p.name} and all photos, notes, timeline and messages? This cannot be undone.`)) return;
    pending.current.add(p.id);
    setBusy(new Set(pending.current));
    try {
      const res = await fetch(`/api/dating/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setRemoved((ids) => new Set([...ids, p.id]));
      router.refresh();
    } catch {
      showToast(`Couldn't delete ${p.name}. Please try again.`);
    } finally {
      finish(p.id);
    }
  };

  const actions = { move, remove, busy };
  return (
    <section className="mb-8" aria-label="People">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-muted-foreground)]">People</h2>
        {people.length > 0 && (
          <div className="relative w-full sm:w-64">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-3.5 size-4 text-[var(--color-muted-foreground)]" />
            <input
              ref={searchInput}
              type="text"
              inputMode="search"
              aria-label="Search people"
              placeholder="Search people"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); clearSearch(); } }}
              className="min-h-11 w-full rounded-lg bg-[var(--color-fill-secondary)] pl-9 pr-11 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
            {query && <button type="button" aria-label="Clear search" onClick={clearSearch} className="absolute right-0 top-0 grid size-11 place-items-center rounded-lg text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"><X aria-hidden className="size-4" /></button>}
          </div>
        )}
      </div>
      <p aria-live="polite" aria-atomic="true" className={cn("text-xs text-[var(--color-muted-foreground)]", searching ? "mb-3" : "sr-only")}>
        {searching ? `${matches.length} ${matches.length === 1 ? "person" : "people"} found` : ""}
      </p>
      {current.length > 0 ? (
        <PeopleGrid people={current} label="Current relationships" {...actions} />
      ) : !searching ? (
        <p className="rounded-xl border border-dashed border-[var(--color-card-border)] px-5 py-6 text-sm text-[var(--color-muted-foreground)]">
          {past.length ? "No current relationships. Past relationships are below." : "Add someone to get started."}
        </p>
      ) : matches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-card-border)] px-5 py-5 text-sm text-[var(--color-muted-foreground)]">
          <p>No people match “{query.trim()}”.</p>
          <button type="button" onClick={clearSearch} className="mt-1 min-h-11 underline underline-offset-4 hover:text-[var(--color-foreground)]">Show everyone</button>
        </div>
      ) : null}

      {past.length > 0 && (
        <div className="mt-5 border-t border-[var(--color-card-border)] pt-2">
          {searching ? <h3 className="mb-3 py-2 text-sm text-[var(--color-muted-foreground)]">Past relationships ({past.length})</h3> : <button
            type="button"
            aria-expanded={endedOpen}
            aria-controls={pastId}
            onClick={toggleEnded}
            className="mb-1 flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <ChevronDown aria-hidden className={cn("size-4 transition-transform", !endedOpen && "-rotate-90")} />
            Past relationships <span className="tabular-nums">({past.length})</span>
          </button>}
          <div id={pastId} hidden={!searching && !endedOpen}>
            {(searching || endedOpen) && <PeopleGrid people={past} label="Past relationships" {...actions} />}
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className={cn(
          "fixed bottom-24 left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] px-4 py-3 text-sm shadow-popover md:bottom-8",
          toast.error ? "text-[var(--color-destructive)]" : "text-[var(--color-foreground)]",
        )}>
          {toast.text}
        </div>
      )}
    </section>
  );
}

type Actions = {
  move: (id: string, stage: Stage) => void;
  remove: (p: DatingCard) => void;
  busy: Set<string>;
};

function PeopleGrid({ people, label, ...actions }: { people: DatingCard[]; label: string } & Actions) {
  return (
    <ul aria-label={label} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {people.map((p) => <li key={p.id} className="min-w-0"><PersonCard p={p} {...actions} /></li>)}
    </ul>
  );
}

function PersonCard({ p, move, remove, busy }: { p: DatingCard } & Actions) {
  const dates = relationshipDates(p);
  return (
    <div className="relative flex h-full items-start gap-3 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 transition-colors hover:bg-[var(--color-fill-secondary)]">
      {p.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.avatarUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-full bg-[var(--color-fill)] object-cover" />
      ) : (
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--color-fill)] text-sm font-medium text-[var(--color-muted-foreground)]">
          {initials(p.name) || "?"}
        </span>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <Link href={`/dating/${p.id}`} className="block break-words text-base font-semibold leading-snug after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[var(--color-ring)]">
          {p.name}
        </Link>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{LABEL[isStage(p.stage) ? p.stage : "talking"]}</p>
        {dates && <p className="mt-2 text-xs tabular-nums text-[var(--color-muted-foreground)]">{dates}</p>}
      </div>
      <label title={busy.has(p.id) ? "Saving…" : "Actions"} className="relative z-10 -mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full text-[var(--color-muted-foreground)] focus-within:ring-2 focus-within:ring-[var(--color-ring)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]">
        <Ellipsis aria-hidden className="size-4" />
        <span className="sr-only">Actions for {p.name}</span>
        <select
          value=""
          disabled={busy.has(p.id)}
          onChange={(e) => {
            if (e.target.value === "delete") remove(p);
            else if (isStage(e.target.value)) move(p.id, e.target.value);
          }}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
        >
          <option value="" disabled>{busy.has(p.id) ? "Saving…" : "Actions…"}</option>
          <optgroup label="Change status">
            {STAGES.filter((s) => s !== p.stage).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
          </optgroup>
          <option value="delete">Delete person…</option>
        </select>
      </label>
    </div>
  );
}
