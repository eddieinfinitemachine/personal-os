"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, Loader2, Trash2 } from "lucide-react";
import { haptic } from "@/lib/haptic";

// Home header: pick a recent Granola meeting → /api/meetings/granola/parse
// proposes who committed to what, each routed to that person's EC/* list →
// every row is reviewed here (pre-checked) → /api/meetings/commit adds them.
// Nothing is saved until the user clicks Add.

type Meeting = {
  id: string;
  title: string;
  createdAt: string;
  owner: { name: string | null; email: string | null };
  /** Already turned into todos (by this button or the auto-import cron). */
  imported?: boolean;
};

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
  listId: string; // "" = To Do (inbox)
};

type CommitResult = {
  created: number;
  byList: { listId: string; listName: string; count: number }[];
};

type Phase = "closed" | "pick" | "extracting" | "review" | "adding" | "done";

const TO_DO_LABEL = "To Do";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ImportGranolaButton() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [phase, setPhase] = useState<Phase>("closed");
  const [error, setError] = useState<string | null>(null);

  // pick
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // extracting
  const [picked, setPicked] = useState<Meeting | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const parseAbort = useRef<AbortController | null>(null);

  // review
  const [noteId, setNoteId] = useState<string | null>(null);
  const [meetingTitle, setMeetingTitle] = useState<string | null>(null);
  const [meetingDate, setMeetingDate] = useState<string | null>(null);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);

  // done
  const [result, setResult] = useState<CommitResult | null>(null);

  // Load the meeting list each time the picker is opened from the button.
  const listAbort = useRef<AbortController | null>(null);
  async function openPicker() {
    listAbort.current?.abort();
    const controller = new AbortController();
    listAbort.current = controller;
    setError(null);
    setPhase("pick");
    setLoadingMeetings(true);
    try {
      const res = await fetch("/api/meetings/granola", { signal: controller.signal });
      const j = (await res.json().catch(() => ({}))) as { meetings?: Meeting[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? `Couldn't load meetings (HTTP ${res.status}).`);
      setMeetings(j.meetings ?? []);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Network error.");
      }
    } finally {
      if (listAbort.current === controller) {
        listAbort.current = null;
        setLoadingMeetings(false);
      }
    }
  }

  // The picker closes on outside click / Escape. Review and adding never do:
  // losing a half-edited triage to a stray click would be worse than a click.
  useEffect(() => {
    if (phase !== "pick") return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setPhase("closed");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPhase("closed");
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [phase]);

  // Elapsed-seconds ticker for the extracting interstitial.
  useEffect(() => {
    if (phase !== "extracting") {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const included = useMemo(() => drafts.filter((d) => d.include && d.title.trim()), [drafts]);

  const listLabel = useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l.name]));
    return (id: string) => (id ? (byId.get(id) ?? TO_DO_LABEL) : TO_DO_LABEL);
  }, [lists]);

  const countsByList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of included) {
      const label = listLabel(d.listId);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [included, listLabel]);

  async function extract(meeting: Meeting) {
    const controller = new AbortController();
    parseAbort.current = controller;
    setPicked(meeting);
    setError(null);
    setPhase("extracting");
    try {
      const res = await fetch("/api/meetings/granola/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: meeting.id }),
        signal: controller.signal,
      });
      const j = (await res.json().catch(() => ({}))) as {
        noteId?: string;
        meetingTitle?: string | null;
        meetingDate?: string | null;
        webUrl?: string | null;
        items?: ParsedItem[];
        lists?: ListOption[];
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `Extraction failed (HTTP ${res.status}).`);
        setPhase("pick");
        return;
      }
      const options = j.lists ?? [];
      const optionIds = new Set(options.map((l) => l.id));
      if (!j.items?.length) {
        setError(`No action items found in ${meeting.title}.`);
        setPhase("pick");
        return;
      }
      setNoteId(j.noteId ?? meeting.id);
      setMeetingTitle(j.meetingTitle ?? meeting.title);
      setMeetingDate(j.meetingDate ?? null);
      setWebUrl(j.webUrl ?? null);
      setLists(options);
      setDrafts(
        j.items.map((it) => ({
          include: true,
          title: it.title,
          owner: it.owner,
          notes: it.notes ?? "",
          dueDate: it.dueDate ?? "",
          listId: it.listId && optionIds.has(it.listId) ? it.listId : "",
        })),
      );
      haptic("success");
      setPhase("review");
    } catch (e) {
      // A user-initiated cancel just returns to the picker, no error.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Network error.");
      }
      setPhase("pick");
    } finally {
      parseAbort.current = null;
    }
  }

  async function commit() {
    const items = included.map((d) => ({
      title: d.title.trim(),
      notes: d.notes.trim() || null,
      dueDate: d.dueDate || null,
      listId: d.listId || null,
    }));
    if (items.length === 0) return;
    setPhase("adding");
    setError(null);
    try {
      const res = await fetch("/api/meetings/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId, meetingTitle, meetingDate, sourceUrl: webUrl, items }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Add failed (HTTP ${res.status}).`);
        setPhase("review");
        return;
      }
      setResult((await res.json()) as CommitResult);
      haptic("success");
      setPhase("done");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setPhase("review");
    }
  }

  function update(i: number, patch: Partial<DraftItem>) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function close() {
    parseAbort.current?.abort();
    setPhase("closed");
    setDrafts([]);
    setResult(null);
    setError(null);
    setPicked(null);
  }

  const modal = phase === "extracting" || phase === "review" || phase === "adding" || phase === "done";

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => {
          if (phase === "pick") setPhase("closed");
          else if (phase === "closed") void openPicker();
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:border-[var(--color-foreground)]/30 transition"
      >
        <Download className="size-3.5" />
        Import Granola
      </button>

      {phase === "pick" ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-xl p-1.5">
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Recent meetings
          </div>
          {error ? <p className="px-2 pb-2 text-xs text-rose-500">{error}</p> : null}
          {loadingMeetings ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-[var(--color-muted-foreground)]">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          ) : meetings && meetings.length === 0 ? (
            <p className="px-2 py-3 text-sm text-[var(--color-muted-foreground)]">
              No Granola meetings in the last 14 days.
            </p>
          ) : meetings ? (
            <ul className="max-h-80 overflow-y-auto">
              {meetings.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => extract(m)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-accent)]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm">{m.title}</span>
                      {m.imported ? (
                        <span className="shrink-0 rounded border border-[var(--color-border)] px-1 text-[10px] leading-4 text-[var(--color-muted-foreground)]">
                          Imported
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {shortDate(m.createdAt)}
                      {m.owner.name ? ` · ${m.owner.name}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {modal ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onMouseDown={(e) => {
            // Only the finished summary closes on a backdrop click.
            if (e.target === e.currentTarget && phase === "done") close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Import Granola meeting"
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl"
          >
            {phase === "extracting" ? (
              <div className="grid place-items-center gap-3 px-6 py-14 text-center">
                <Loader2 className="size-6 animate-spin text-[var(--color-muted-foreground)]" />
                <div className="text-sm font-semibold">Reading {picked?.title ?? "the meeting"}…</div>
                <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">
                  Claude is reading the summary and transcript and pulling out who committed to
                  what. Long meetings take 20–30 seconds.
                </p>
                <div className="text-xs tabular-nums text-[var(--color-muted-foreground)]">{elapsed}s</div>
                <button
                  onClick={() => parseAbort.current?.abort()}
                  className="mt-1 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-accent)] min-h-[40px]"
                >
                  Cancel
                </button>
              </div>
            ) : phase === "done" && result ? (
              <div className="p-6">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Check className="size-4 text-[var(--color-tint)]" />
                  Added {result.created}
                  {result.byList.map((b) => (
                    <span key={b.listId} className="font-normal text-[var(--color-muted-foreground)]">
                      · {b.listName} ×{b.count}
                    </span>
                  ))}
                </div>
                {meetingTitle ? (
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">From {meetingTitle}</p>
                ) : null}
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={close}
                    className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium min-h-[40px]"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="border-b border-[var(--color-border)] px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-semibold">
                      {meetingTitle ?? "Meeting"}
                      {meetingDate ? (
                        <span className="ml-2 font-normal text-[var(--color-muted-foreground)]">{meetingDate}</span>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                      {included.length} of {drafts.length} selected
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    {countsByList.length
                      ? countsByList.map(([name, n]) => `${name} ×${n}`).join(" · ")
                      : "Nothing selected"}
                  </div>
                </div>

                <div className="grid gap-2 overflow-y-auto px-5 py-3">
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
                          aria-label="Include"
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
                              <option value="">To Do (inbox)</option>
                              {lists.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            {d.owner ? (
                              <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">{d.owner}</span>
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
                              aria-label="Due date"
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

                <div className="border-t border-[var(--color-border)] px-5 py-3">
                  {error ? <p className="mb-2 text-sm text-rose-500">{error}</p> : null}
                  <div className="flex items-center justify-between gap-2">
                    <span className="hidden sm:block text-xs text-[var(--color-muted-foreground)]">
                      To Do items are filed to Inbox for triage.
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        onClick={close}
                        disabled={phase === "adding"}
                        className="rounded-md px-3 py-2 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-50 min-h-[40px]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={commit}
                        disabled={included.length === 0 || phase === "adding"}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[40px]"
                      >
                        {phase === "adding" ? <Loader2 className="size-4 animate-spin" /> : null}
                        {phase === "adding"
                          ? "Adding…"
                          : `Add ${included.length} ${included.length === 1 ? "todo" : "todos"}`}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
