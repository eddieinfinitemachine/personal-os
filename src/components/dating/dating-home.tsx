"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link2, Loader2, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { DictateCard } from "./dictate-card";
import { GranolaSync } from "./granola-sync";
import { SyncHelp } from "./sync-help";
import { PeopleBoard, type DatingCard } from "./people-board";
import { LinkPicker, type PickablePerson } from "./link-picker";
import { QuickAdd } from "./quick-add";

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
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50";

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
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6 max-w-6xl">
      <header className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-large-title font-bold">Dating</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Remember the details, see how it&apos;s going, learn from each one.
          </p>
        </div>
        <button onClick={() => setAdding(true)} className={ghost} aria-haspopup="dialog">
          <Plus className="size-4" /> Add
        </button>
      </header>

      {adding && <QuickAdd onClose={() => setAdding(false)} />}

      {error && (
        <div className="mb-4 rounded-md bg-[var(--color-fill)] px-3 py-2 text-sm text-[var(--color-destructive)]">{error}</div>
      )}

      <PeopleBoard people={people} />

      {/* Everything below the people view keeps the narrower reading width. */}
      <div className="max-w-5xl">
        {granola && <GranolaSync />}

        {suggestions.length > 0 && <Suggestions suggestions={suggestions} people={people} setError={setError} />}

        <div className="mb-6">
          <DictateCard onSaved={() => router.refresh()} />
        </div>

        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Lessons</h2>
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
        </section>

        <section className={cn(card, "mt-8 p-4")}>
          <SyncHelp compact />
        </section>
      </div>
    </div>
  );
}

// People Granola meetings talked about who aren't here yet.
function Suggestions({
  suggestions,
  people,
  setError,
}: {
  suggestions: GranolaSuggestion[];
  people: PickablePerson[];
  setError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState<GranolaSuggestion | null>(null);

  // Only the selected note is reviewed; the same name may refer to someone else.
  const link = async (s: GranolaSuggestion, person: PickablePerson) => {
    setLinking(null);
    const ids = [s.id];
    setGone((g) => new Set([...g, ...ids]));
    const res = await fetch(`/api/dating/suggestions/${s.id}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: person.id }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setGone((g) => {
        const next = new Set(g);
        for (const id of ids) next.delete(id);
        return next;
      });
      return setError(`Could not add ${s.name} to ${person.name}: ${data.error ?? "network error"}`);
    }
    setError(null);
    router.refresh();
  };
  const act = async (s: GranolaSuggestion, action: "add" | "dismiss") => {
    setBusy(s.id);
    const res = await fetch(`/api/dating/suggestions/${s.id}/${action}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Could not update");
    setError(null);
    if (action === "add") return router.push(`/dating/${data.person.id}`);
    setGone((g) => new Set(g).add(s.id));
    router.refresh();
  };
  const visible = suggestions.filter((s) => !gone.has(s.id));
  if (!visible.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        Review from Granola
      </h2>
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
                className="pressable inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-[var(--color-foreground)] text-[var(--color-background)] disabled:opacity-50"
              >
                {busy === s.id ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add her
              </button>
              {people.length > 0 && (
                <button
                  onClick={() => setLinking(s)}
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
