"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { daysSince } from "@/lib/dating";
import type { DatingPersonDTO } from "@/lib/dating-server";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { DictateCard } from "./dictate-card";
import { SyncHelp } from "./sync-help";

export type DatingCard = DatingPersonDTO & {
  messageCount: number;
  dateCount: number;
  avgVibe: number | null;
  /** Messages per week, last 12 weeks, oldest first. */
  spark: number[];
};

const input =
  "rounded-md bg-[var(--color-fill-secondary)] px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]";
const card = "rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]";
const ghost =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50";

export function DatingHome({ people }: { people: DatingCard[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(people.length === 0);
  const [name, setName] = useState("");
  const [handles, setHandles] = useState("");
  const [metVia, setMetVia] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<string | null>(null);
  const [patternsBusy, setPatternsBusy] = useState(false);

  const active = people.filter((p) => p.stage !== "ended");
  const past = people.filter((p) => p.stage === "ended");
  const withLessons = people.filter((p) => p.lessons?.trim());

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/dating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, handles, metVia, metAt: new Date().toISOString() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not add");
    router.push(`/dating/${data.person.id}`);
  };

  const findPatterns = async () => {
    setPatternsBusy(true);
    const res = await fetch("/api/dating/patterns", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setPatternsBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not find patterns");
    setPatterns(data.text);
    setError(null);
  };

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6 max-w-5xl">
      <header className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-large-title font-bold">Dating</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Remember the details, see how it&apos;s going, learn from each one.
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className={ghost}>
            <Plus className="size-4" /> Add
          </button>
        )}
      </header>

      {error && (
        <div className="mb-4 rounded-md bg-[var(--color-fill)] px-3 py-2 text-sm text-[var(--color-destructive)]">{error}</div>
      )}

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className={cn(card, "mb-6 p-4 flex flex-wrap items-center gap-2")}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={cn(input, "flex-1 min-w-[140px]")} />
          <input
            value={handles}
            onChange={(e) => setHandles(e.target.value)}
            placeholder="Phone (for iMessage)"
            className={cn(input, "flex-1 min-w-[160px]")}
          />
          <input value={metVia} onChange={(e) => setMetVia(e.target.value)} placeholder="Met via" className={cn(input, "w-36")} />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="pressable inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-[var(--color-foreground)] text-[var(--color-background)] disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />} Add
          </button>
          {people.length > 0 && (
            <button type="button" onClick={() => setAdding(false)} className={ghost}>
              Cancel
            </button>
          )}
        </form>
      )}

      <div className="mb-6">
        <DictateCard onSaved={() => router.refresh()} />
      </div>

      <Section title="Now" people={active} empty="No one right now." />
      {past.length > 0 && <Section title="Past" people={past} />}

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
            <SimpleMarkdown text={patterns} />
          </div>
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
  );
}

function Section({ title, people, empty }: { title: string; people: DatingCard[]; empty?: string }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">{title}</h2>
      {!people.length ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => (
            <PersonCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function PersonCard({ p }: { p: DatingCard }) {
  const since = daysSince(p.lastMessageAt);
  const max = Math.max(1, ...p.spark);
  return (
    <Link href={`/dating/${p.id}`} className={cn(card, "block p-4 hover:bg-[var(--color-fill-secondary)] transition")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{p.name}</div>
          <div className="text-xs text-[var(--color-muted-foreground)] truncate">
            {[p.metVia, p.age, p.city].filter(Boolean).join(" · ") || " "}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-fill)] px-2 py-0.5 text-xs capitalize">{p.stage}</span>
      </div>
      {p.spark.some(Boolean) && (
        <div className="mt-3 flex h-8 items-end gap-[2px]" aria-label="Messages per week, last 12 weeks">
          {p.spark.map((n, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-[2px] bg-[var(--color-tint)]"
              style={{ height: `${Math.max(n ? 8 : 0, (n / max) * 100)}%`, opacity: n ? 1 : 0 }}
            />
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-muted-foreground)] tabular-nums">
        {since !== null && <span>{since === 0 ? "texted today" : `last text ${since}d ago`}</span>}
        {p.messageCount > 0 && <span>{p.messageCount.toLocaleString()} msgs</span>}
        {p.dateCount > 0 && <span>{p.dateCount} dates</span>}
        {p.avgVibe !== null && <span>vibe {p.avgVibe.toFixed(1)}</span>}
      </div>
      {p.remember.length > 0 && (
        <p className="mt-2 text-xs text-[var(--color-label-tertiary)] line-clamp-2">{p.remember.slice(0, 3).join(" · ")}</p>
      )}
    </Link>
  );
}
