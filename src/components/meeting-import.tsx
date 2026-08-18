"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, Sparkles, Trash2 } from "lucide-react";
import { haptic } from "@/lib/haptic";

// Paste a Granola transcript → /api/meetings/parse proposes action items with
// a destination list each → every row is edited/confirmed here → commit.
// Mirrors BulkAddPeople's input → review two-step; nothing is saved until the
// user clicks Add.

type ListOption = { id: string; name: string };

type ParsedItem = {
  title: string;
  owner: string | null;
  notes: string | null;
  dueDate: string | null;
  listId: string | null;
  listName: string | null;
};

type DraftItem = {
  include: boolean;
  title: string;
  owner: string | null;
  notes: string;
  dueDate: string;
  listId: string;
};

type CommitResult = {
  created: number;
  byList: { listId: string; listName: string; count: number }[];
};

const PLACEHOLDER = `Paste the whole transcript — the Granola header helps:

Meeting Title: GTM Team Sync
Date: Aug 17
Meeting participants: Dave, Obie, Ben, Ash, Eddie

Transcript:
…`;

export function MeetingImport({
  lists,
  toDoListId,
}: {
  lists: ListOption[];
  toDoListId: string | null;
}) {
  const router = useRouter();
  const fallbackListId = toDoListId ?? lists[0]?.id ?? "";
  const [phase, setPhase] = useState<"input" | "review" | "done">("input");
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meetingTitle, setMeetingTitle] = useState<string | null>(null);
  const [meetingDate, setMeetingDate] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const parseAbort = useRef<AbortController | null>(null);

  // Elapsed-seconds ticker for the processing interstitial.
  useEffect(() => {
    if (!parsing) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [parsing]);

  const includedCount = useMemo(
    () => drafts.filter((d) => d.include && d.title.trim()).length,
    [drafts]
  );

  async function parse() {
    const body = text.trim();
    if (!body) return;
    const controller = new AbortController();
    parseAbort.current = controller;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Parse failed (HTTP ${res.status}).`);
        return;
      }
      const data = (await res.json()) as {
        meetingTitle: string | null;
        meetingDate: string | null;
        items: ParsedItem[];
      };
      if (!data.items.length) {
        setError("No action items found in that transcript.");
        return;
      }
      setMeetingTitle(data.meetingTitle);
      setMeetingDate(data.meetingDate);
      setDrafts(
        data.items.map((it) => ({
          include: true,
          title: it.title,
          owner: it.owner,
          notes: it.notes ?? "",
          dueDate: it.dueDate ?? "",
          listId: it.listId ?? fallbackListId,
        }))
      );
      haptic("success");
      setPhase("review");
    } catch (e) {
      // A user-initiated cancel just returns to the paste screen, no error.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Network error.");
      }
    } finally {
      parseAbort.current = null;
      setParsing(false);
    }
  }

  async function commit() {
    const items = drafts
      .filter((d) => d.include && d.title.trim())
      .map((d) => ({
        title: d.title.trim(),
        notes: d.notes.trim() || null,
        dueDate: d.dueDate || null,
        listId: d.listId || null,
      }));
    if (items.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingTitle, meetingDate, items }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Add failed (HTTP ${res.status}).`);
        return;
      }
      setResult((await res.json()) as CommitResult);
      haptic("success");
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setCommitting(false);
    }
  }

  function update(i: number, patch: Partial<DraftItem>) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function reset() {
    setPhase("input");
    setText("");
    setDrafts([]);
    setMeetingTitle(null);
    setMeetingDate(null);
    setResult(null);
    setError(null);
  }

  if (phase === "done" && result) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Check className="size-4 text-[var(--color-tint)]" />
          Added {result.created} {result.created === 1 ? "todo" : "todos"}
          {meetingTitle ? ` from ${meetingTitle}` : ""}
        </div>
        <ul className="mt-3 grid gap-1 text-sm text-[var(--color-muted-foreground)]">
          {result.byList.map((b) => (
            <li key={b.listId}>
              {b.listName} — {b.count}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={reset}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-accent)] min-h-[40px]"
          >
            Import another
          </button>
          <Link
            href="/"
            className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium min-h-[40px] inline-flex items-center"
          >
            Done
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "review") {
    return (
      <div className="grid gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-semibold">
            {meetingTitle ?? "Meeting"}
            {meetingDate ? (
              <span className="ml-2 font-normal text-[var(--color-muted-foreground)]">
                {meetingDate}
              </span>
            ) : null}
          </div>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {includedCount} of {drafts.length} selected
          </span>
        </div>
        <p className="-mt-1 text-xs text-[var(--color-muted-foreground)]">
          Triage: pick the list each task goes to, edit or uncheck anything —
          nothing is added until you confirm.
        </p>

        <div className="grid gap-2">
          {drafts.map((d, i) => (
            <div
              key={i}
              className={
                "rounded-xl border p-3 " +
                (d.include
                  ? "border-[var(--color-border)] bg-[var(--color-card)]"
                  : "border-dashed border-[var(--color-border)] opacity-50")
              }
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={d.include}
                  onChange={(e) => update(i, { include: e.target.checked })}
                  className="mt-2 size-4 accent-[var(--color-foreground)]"
                />
                <div className="flex-1 grid gap-1.5">
                  <div className="flex flex-col sm:flex-row gap-1.5">
                    <input
                      type="text"
                      value={d.title}
                      onChange={(e) => update(i, { title: e.target.value })}
                      placeholder="Task"
                      className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none min-h-[36px]"
                    />
                    <select
                      value={d.listId}
                      onChange={(e) => update(i, { listId: e.target.value })}
                      className="sm:w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none min-h-[36px]"
                    >
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.owner ? (
                      <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                        {d.owner}
                      </span>
                    ) : null}
                    <input
                      type="text"
                      value={d.notes}
                      onChange={(e) => update(i, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-[var(--color-muted-foreground)] focus:border-[var(--color-border)] focus:bg-[var(--color-background)] focus:outline-none"
                    />
                    <input
                      type="date"
                      value={d.dueDate}
                      onChange={(e) => update(i, { dueDate: e.target.value })}
                      className="shrink-0 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-[var(--color-muted-foreground)] focus:border-[var(--color-border)] focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                  className="mt-1.5 rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                  aria-label="Remove"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            onClick={() => setPhase("input")}
            className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-2 py-2"
          >
            ← Back to transcript
          </button>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs text-[var(--color-muted-foreground)]">
              To Do items are filed to Inbox for triage.
            </span>
            <button
              onClick={commit}
              disabled={includedCount === 0 || committing}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[40px]"
            >
              {committing ? <Loader2 className="size-4 animate-spin" /> : null}
              {committing
                ? "Adding…"
                : `Add ${includedCount} ${includedCount === 1 ? "todo" : "todos"}`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (parsing) {
    return (
      <div className="grid place-items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-6 py-14 text-center">
        <Loader2 className="size-6 animate-spin text-[var(--color-muted-foreground)]" />
        <div className="text-sm font-semibold">Extracting next steps…</div>
        <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">
          Claude is reading the transcript and pulling out who committed to
          what. Long meetings take 20–30 seconds — the triage screen opens
          automatically when it&apos;s done.
        </p>
        <div className="text-xs tabular-nums text-[var(--color-muted-foreground)]">
          {elapsed}s
        </div>
        <button
          onClick={() => parseAbort.current?.abort()}
          className="mt-1 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-accent)] min-h-[40px]"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        rows={14}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm leading-relaxed focus:border-[var(--color-ring)] focus:outline-none resize-y"
      />
      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--color-muted-foreground)]">
          Every item is reviewed before anything is saved.
        </span>
        <button
          onClick={parse}
          disabled={!text.trim() || parsing}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[40px]"
        >
          {parsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {parsing ? "Extracting…" : "Extract next steps"}
        </button>
      </div>
    </div>
  );
}
