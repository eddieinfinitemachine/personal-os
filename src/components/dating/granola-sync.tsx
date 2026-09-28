"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Batch = {
  durable?: boolean;
  processed: number;
  filed: number;
  suggestions: number;
  remaining: number;
  errors: { meetingId: string; title: string | null; error: string }[];
  nextSince: string;
  nextAfterId: string | null;
};

type Progress = { checked: number; total: number; filed: number; added: number; errors: number };

const card = "rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]";
const ghost =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50";
const input =
  "min-h-11 rounded-md bg-[var(--color-fill-secondary)] px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]";

const MAX_BATCHES = 300;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function describe(p: Progress): string {
  return [`${p.checked} of ${p.total} checked`, `${p.filed} filed`, `${p.added} new`, p.errors ? `${p.errors} failed` : null]
    .filter(Boolean)
    .join(" · ");
}

function status(p: Progress | null, done: boolean, error: string | null, paused: boolean): string {
  if (error) return p?.checked ? `${describe(p)} · ${error}` : error;
  if (!p) return "";
  if (p.total > 0) return `${describe(p)}${done ? " · done" : paused ? " · paused" : ""}`;
  return done ? "Nothing new in that range." : "Listing meetings…";
}

/**
 * Pull Granola meetings onto /dating: "Sync now" (last 10 days) or
 * "Import since…" a date. Each request is one server batch; this loops,
 * passing back nextSince and nextAfterId, until the server says nothing remains.
 */
export function GranolaSync() {
  const router = useRouter();
  const [since, setSince] = useState("2026-01-01");
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState<"sync" | "import" | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [paused, setPaused] = useState(false);
  const [queued, setQueued] = useState(false);
  const pending = useRef(false);
  const stop = useRef(false);
  const [retry, setRetry] = useState<{ kind: "sync" | "import"; since: string; afterId?: string; action: "Retry" | "Continue" } | null>(null);

  const run = async (kind: "sync" | "import", from: string, fromId?: string) => {
    if (pending.current) return;
    pending.current = true;
    setQueued(false);
    setRunning(kind);
    setError(null);
    setDone(false);
    setPaused(false);
    setRetry(null);
    stop.current = false;
    const p: Progress = { checked: 0, total: 0, filed: 0, added: 0, errors: 0 };
    setProgress({ ...p });
    let cursor = from;
    let afterId = fromId;
    let complete = false;
    try {
      for (let i = 0; i < MAX_BATCHES && !stop.current; i++) {
        const res = await fetch("/api/dating/granola/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ since: cursor, afterId }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<Batch> & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Sync failed (${res.status})`);
        if (data.durable) { setQueued(true); setPicking(false); return; }
        const b = data as Batch;
        p.checked += b.processed;
        p.total = p.checked + b.remaining;
        p.filed += b.filed;
        p.added += b.suggestions;
        p.errors += b.errors.length;
        setProgress({ ...p });
        if (b.errors.length) {
          cursor = b.nextSince;
          afterId = b.nextAfterId ?? undefined;
          throw new Error(`${b.errors[0].title || "Meeting"}: ${b.errors[0].error}. Retry to continue from here.`);
        }
        if (b.remaining <= 0) {
          complete = true;
          break;
        }
        if (b.nextSince === cursor && (b.nextAfterId ?? undefined) === afterId) {
          throw new Error("Sync made no progress. Retry to continue from here.");
        }
        cursor = b.nextSince;
        afterId = b.nextAfterId ?? undefined;
      }
      setDone(complete);
      if (complete) setPicking(false);
      else {
        setPaused(true);
        setRetry({ kind, since: cursor, afterId, action: "Continue" });
      }
    } catch (e) {
      setRetry({ kind, since: cursor, afterId, action: "Retry" });
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      pending.current = false;
      setRunning(null);
      router.refresh();
    }
  };

  const text = queued && !error ? "Queued for review; automatic processing continues. Check source status for progress." : status(progress, done, error, paused);

  return (
    <section className={cn(card, "mb-6 p-3")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-sm font-semibold">Granola</div>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Check meeting notes now or import an earlier date range. New intake suggestions appear in People to review.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {retry && !running && (
            <button onClick={() => run(retry.kind, retry.since, retry.afterId)} className={ghost}>
              {retry.action}
            </button>
          )}
          <button onClick={() => run("sync", daysAgo(10))} disabled={running !== null} className={ghost}>
            {running === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Sync now
          </button>
          {picking ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (since) run("import", since);
              }}
              className="flex items-center gap-1"
            >
              <input
                type="date"
                value={since}
                max={daysAgo(0)}
                onChange={(e) => setSince(e.target.value)}
                aria-label="Import meetings since"
                className={input}
              />
              <button
                type="submit"
                disabled={running !== null || !since}
                className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-[var(--color-foreground)] text-[var(--color-background)] disabled:opacity-50"
              >
                {running === "import" && <Loader2 className="size-4 animate-spin" />} Import
              </button>
              {!running && (
                <button type="button" onClick={() => setPicking(false)} className={ghost}>
                  Cancel
                </button>
              )}
            </form>
          ) : (
            <button onClick={() => setPicking(true)} disabled={running !== null} className={ghost}>
              <Download className="size-4" /> Import since…
            </button>
          )}
          {running && (
            <button onClick={() => (stop.current = true)} className={ghost}>
              Stop
            </button>
          )}
        </div>
      </div>
      {text && (
        <p
          role="status"
          className={cn(
            "mt-2 text-xs tabular-nums",
            error ? "text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]",
          )}
        >
          {text}
        </p>
      )}
      <OrganizeAll />
    </section>
  );
}

/** The browser's local YYYY-MM-DD. */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type OrganizeBatch = {
  done: number;
  remaining: number;
  failed: string[];
  results: { personId: string; name: string; status: string; summary: string }[];
};

/**
 * "Organize everyone's notes with Claude": files each person's notes field
 * into dated events, flags and lessons, a few people per request, looping
 * until none are left. Hidden when nobody has unorganized notes.
 */
function OrganizeAll() {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    let live = true;
    fetch("/api/dating/organize-all")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setLeft(d.remaining))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    stop.current = false;
    const skip: string[] = [];
    let organized = 0;
    const total = left ?? 0;
    setLine(`Organizing… 0 of ${total}`);
    try {
      for (let i = 0; i < 100 && !stop.current; i++) {
        const res = await fetch("/api/dating/organize-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skip, today: localDay() }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<OrganizeBatch> & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Organize failed (${res.status})`);
        const b = data as OrganizeBatch;
        organized += b.done;
        skip.push(...b.failed);
        setLeft(b.remaining);
        const last = b.results.filter((r) => r.status === "done").at(-1);
        setLine(
          [
            `${organized} of ${total} organized`,
            skip.length ? `${skip.length} failed` : null,
            last ? `${last.name}: ${last.summary}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        );
        if (b.remaining <= 0 || !b.results.length) break;
      }
      if (!stop.current) setLine((l) => `${l ?? ""} · done`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Organize failed");
    } finally {
      setRunning(false);
      router.refresh();
    }
  };

  if (!left && !line) return null;
  return (
    <div className="mt-3 border-t border-[var(--color-separator)] pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-48 text-xs text-[var(--color-muted-foreground)]">
          Turn everyone&apos;s notes into dates, flags and lessons.
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {!!left && (
            <button onClick={run} disabled={running} className={ghost}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Organize everyone&apos;s notes with Claude ({left} left)
            </button>
          )}
          {running && (
            <button onClick={() => (stop.current = true)} className={ghost}>
              Stop
            </button>
          )}
        </div>
      </div>
      {(line || error) && (
        <p
          role="status"
          className={cn(
            "mt-2 text-xs tabular-nums",
            error ? "text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]",
          )}
        >
          {error ? [line, error].filter(Boolean).join(" · ") : line}
        </p>
      )}
    </div>
  );
}
