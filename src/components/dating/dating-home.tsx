"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Link2, Loader2, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { DictateCard } from "./dictate-card";
import { GranolaSync } from "./granola-sync";
import { SyncHelp } from "./sync-help";
import { PeopleBoard, type DatingCard } from "./people-board";
import { LinkPicker, type PickablePerson } from "./link-picker";
import { QuickAdd } from "./quick-add";
import { ReviewInbox } from "./review-inbox";
import { DatingSourcesProvider, SourceStatus, SourceSettings } from "./source-status";

export type { DatingCard };

export type GranolaSuggestion = {
  id: string;
  name: string;
  summary: string;
  title: string | null;
  url: string | null;
  occurredAt: string;
};

const card = "rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]";
const ghost =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50";
const LESSONS_OPEN_KEY = "personalos:dating-lessons-open";

export function DatingHome({
  people,
  suggestions,
  granola = false,
}: {
  people: DatingCard[];
  suggestions: GranolaSuggestion[];
  /** Show the Granola sync control (founder only: the API key is personal). */
  granola?: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<{ text: string; taste: string | null; photos: number } | null>(null);
  const [patternsBusy, setPatternsBusy] = useState(false);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const lessonsId = useId();

  useEffect(() => {
    try { setLessonsOpen(localStorage.getItem(LESSONS_OPEN_KEY) === "1"); } catch {}
  }, []);

  const toggleLessons = () => {
    const next = !lessonsOpen;
    setLessonsOpen(next);
    try { localStorage.setItem(LESSONS_OPEN_KEY, next ? "1" : "0"); } catch {}
  };

  const withLessons = people.filter((p) => p.lessons?.trim());

  const findPatterns = async () => {
    setPatternsBusy(true);
    try {
      const res = await fetch("/api/dating/patterns", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "Could not find patterns");
      setPatterns({ text: data.text ?? "", taste: data.taste ?? null, photos: data.photos ?? 0 });
      setError(null);
    } catch {
      setError("Could not find patterns. Try again.");
    } finally {
      setPatternsBusy(false);
    }
  };

  return (
    <DatingSourcesProvider>
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6 max-w-6xl">
      <header className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-large-title font-bold">Dating</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Remember the details, see how it&apos;s going, learn from each one.
          </p>
        </div>
        <button onClick={() => setAdding(true)} className={cn(ghost, "min-h-11 shrink-0")} aria-haspopup="dialog">
          <Plus className="size-4" /> Add person
        </button>
      </header>

      {adding && <QuickAdd onClose={() => setAdding(false)} />}

      {error && (
        <div className="mb-4 rounded-md bg-[var(--color-fill)] px-3 py-2 text-sm text-[var(--color-destructive)]">{error}</div>
      )}

      <SourceStatus />
      <ReviewInbox people={people} />
      <PeopleBoard people={people} />

      {/* Everything below the people view keeps the narrower reading width. */}
      <div className="max-w-5xl">
        {suggestions.length > 0 && <Suggestions suggestions={suggestions} people={people} />}

        <div className="mb-6">
          <DictateCard onSaved={() => router.refresh()} />
        </div>

        <section className="mt-8 border-t border-[var(--color-card-border)] pt-2" aria-label="Lessons">
          <h2>
            <button type="button" onClick={toggleLessons} aria-expanded={lessonsOpen} aria-controls={lessonsId}
              className="mb-1 flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
              <ChevronDown aria-hidden className={cn("size-4 transition-transform", !lessonsOpen && "-rotate-90")} />
              Lessons
            </button>
          </h2>
          <div id={lessonsId} hidden={!lessonsOpen}>
            <div className="mb-2 flex justify-end">
              <button onClick={findPatterns} disabled={patternsBusy} className={ghost}>
                {patternsBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Find patterns
              </button>
            </div>
            {patterns && (
              <div className={cn(card, "p-4 mb-3 text-sm")}>
                <SimpleMarkdown text={patterns.text} />
              </div>
            )}
            {patterns?.taste && (
              <section className={cn(card, "p-4 mb-3 text-sm")} aria-label="Your taste">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <h3 className="text-base font-semibold">Your taste</h3>
                  <span className="text-xs text-[var(--color-label-tertiary)]">
                    {patterns.photos
                      ? `Read with ${patterns.photos} photo${patterns.photos === 1 ? "" : "s"}`
                      : "From notes only. Add photos for a fuller read."}
                  </span>
                </div>
                <SimpleMarkdown text={patterns.taste} />
              </section>
            )}
            {withLessons.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {withLessons.map((p) => (
                  <Link key={p.id} href={`/dating/${p.id}`} className={cn(card, "block p-4 hover:bg-[var(--color-fill-secondary)] transition")}>
                    <div className="text-sm font-medium mb-1">{p.name}</div>
                    <p className="text-sm text-[var(--color-muted-foreground)] whitespace-pre-wrap line-clamp-6">{p.lessons}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Write what each one taught you under Notes. They collect here, and Find patterns reads across all of them.
              </p>
            )}
          </div>
        </section>

        <SourceSettings>
          {/* Keep controls mounted: collapsing must not reset an active import. */}
          <div className="pt-3">
            {granola && <GranolaSync />}
            <SyncHelp compact />
          </div>
        </SourceSettings>
      </div>
    </div>
    </DatingSourcesProvider>
  );
}

// People Granola meetings talked about who aren't here yet.
function Suggestions({
  suggestions,
  people,
}: {
  suggestions: GranolaSuggestion[];
  people: PickablePerson[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const goneIds = useRef(new Set<string>());
  const [gone, setGone] = useState(goneIds.current);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState<GranolaSuggestion | null>(null);

  const begin = (s: GranolaSuggestion) => {
    // Also guard callbacks from a picker that closed before this render.
    if (pending.current || goneIds.current.has(s.id)) return false;
    pending.current = s.id;
    setBusy(s.id);
    setLinking(null);
    setError(null);
    return true;
  };
  const finish = () => {
    pending.current = null;
    setBusy(null);
  };
  const hide = (id: string, hidden = true) => {
    const next = new Set(goneIds.current);
    if (hidden) next.add(id);
    else next.delete(id);
    goneIds.current = next;
    setGone(next);
  };

  // Only the selected note is reviewed; the same name may refer to someone else.
  const link = async (s: GranolaSuggestion, person: PickablePerson) => {
    if (!begin(s)) return;
    hide(s.id);
    let failure = `Could not add ${s.name} to ${person.name}. Try again.`;
    try {
      const res = await fetch(`/api/dating/suggestions/${s.id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: person.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (typeof data.error === "string") failure = `${failure} ${data.error}`;
        throw new Error("Link failed");
      }
      router.refresh();
    } catch {
      hide(s.id, false);
      setError(failure);
    } finally {
      finish();
    }
  };
  const act = async (s: GranolaSuggestion, action: "add" | "dismiss") => {
    if (!begin(s)) return;
    let failure = `Could not ${action === "add" ? "add" : "dismiss"} ${s.name}. Try again.`;
    try {
      const res = await fetch(`/api/dating/suggestions/${s.id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (action === "add" && typeof data.person?.id !== "string")) {
        if (typeof data.error === "string") failure = `${failure} ${data.error}`;
        throw new Error("Review failed");
      }
      hide(s.id);
      if (action === "add") router.push(`/dating/${data.person.id}`);
      else router.refresh();
    } catch {
      setError(failure);
    } finally {
      finish();
    }
  };
  const visible = suggestions.filter((s) => !gone.has(s.id));
  if (!visible.length) return null;
  return (
    <section className="mb-6" aria-label="Review from Granola">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        Earlier Granola mentions <span className="tabular-nums">({visible.length})</span>
      </h2>
      {error && <p role="alert" className="mb-2 rounded-md bg-[var(--color-fill)] px-3 py-2 text-sm text-[var(--color-destructive)]">{error}</p>}
      <ul className="space-y-2">
        {visible.map((s) => (
          <li key={s.id} className={cn(card, "flex flex-wrap items-center gap-x-3 gap-y-2 p-3")}>
            <div className="min-w-0 flex-1 basis-56">
              <div className="text-sm font-semibold">{s.name}</div>
              {s.summary && <p className="text-sm text-[var(--color-muted-foreground)]">{s.summary}</p>}
              <div className="mt-0.5 text-xs text-[var(--color-label-tertiary)]">
                {new Date(s.occurredAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                {" · "}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-[var(--color-foreground)]">
                    {s.title ?? "Granola note"}
                  </a>
                ) : (
                  (s.title ?? "Granola")
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => act(s, "add")}
                disabled={busy !== null}
                className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-[var(--color-foreground)] text-[var(--color-background)] disabled:opacity-50"
              >
                {busy === s.id ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add her
              </button>
              {people.length > 0 && (
                <button
                  onClick={() => { if (!pending.current && !goneIds.current.has(s.id)) setLinking(s); }}
                  disabled={busy !== null}
                  className={ghost}
                  aria-haspopup="dialog"
                  aria-label={`Add ${s.name} to someone already here`}
                >
                  <Link2 className="size-4" /> Add to…
                </button>
              )}
              <button onClick={() => act(s, "dismiss")} disabled={busy !== null} className={ghost} aria-label={`Dismiss ${s.name}`}>
                <X className="size-4" /> Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
      {linking && (
        <LinkPicker
          name={linking.name}
          people={people}
          onPick={(p) => link(linking, p)}
          onClose={() => setLinking(null)}
        />
      )}
    </section>
  );
}
