"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";
import { useOverlayTransition } from "@/lib/use-overlay-transition";

// 1:1 Agenda Mode — a meeting runner for person-lists (EC/*). Step through
// open items, mark them "discussed" (≠ done: stamps lastDiscussedAt and
// bumps discussCount so repeat-raised items show "raised N×"), close what
// got resolved, quick-add what comes up live, and copy a plaintext recap.

type AgendaTodo = {
  id: string;
  title: string;
  notes: string | null;
  createdAt: string;
  lastDiscussedAt: string | null;
  discussCount: number;
};

export function AgendaLauncher({
  listId,
  listName,
}: {
  listId: string;
  listName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="rounded-full px-2 py-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition inline-flex items-center gap-1"
        title={`Run a 1:1 through ${listName}`}
      >
        <MessageSquare className="size-3.5" /> 1:1
      </button>
      {open ? (
        <AgendaMode
          listId={listId}
          listName={listName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function AgendaMode({
  listId,
  listName,
  onClose,
}: {
  listId: string;
  listName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { mounted, state } = useOverlayTransition(true);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AgendaTodo[]>([]);
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notesUrl, setNotesUrl] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  // Session ledger for the recap.
  const [discussedTitles, setDiscussedTitles] = useState<string[]>([]);
  const [closedTitles, setClosedTitles] = useState<string[]>([]);
  const [addedTitles, setAddedTitles] = useState<string[]>([]);

  // The previous meeting's boundary: newest lastDiscussedAt in the list.
  // Items created after it are "new since last 1:1".
  const lastMeetingAt = useMemo(() => {
    let max = 0;
    for (const t of items) {
      if (t.lastDiscussedAt) {
        const v = new Date(t.lastDiscussedAt).getTime();
        if (v > max) max = v;
      }
    }
    return max || null;
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/todos?listId=${listId}`);
        if (!res.ok) throw new Error();
        const { todos } = (await res.json()) as { todos: AgendaTodo[] };
        if (!cancelled) setItems(todos);
      } catch {
        if (!cancelled) setError("Couldn't load the list.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const close = useCallback(() => {
    onClose();
    router.refresh();
  }, [onClose, router]);

  // Meeting order: new-since-last-1:1 first, then carryover (server order
  // within each group).
  const ordered = useMemo(() => {
    if (lastMeetingAt == null) return items;
    const fresh = items.filter(
      (t) => new Date(t.createdAt).getTime() > lastMeetingAt
    );
    const carry = items.filter(
      (t) => new Date(t.createdAt).getTime() <= lastMeetingAt
    );
    return [...fresh, ...carry];
  }, [items, lastMeetingAt]);

  const discuss = useCallback(async () => {
    const t = ordered[idx];
    if (!t || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      const res = await fetch(`/api/todos/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discussed: true }),
      });
      if (!res.ok) throw new Error();
      setDiscussedTitles((d) => [...d, t.title]);
      setItems((arr) =>
        arr.map((x) =>
          x.id === t.id
            ? {
                ...x,
                lastDiscussedAt: new Date().toISOString(),
                discussCount: x.discussCount + 1,
              }
            : x
        )
      );
      setIdx((i) => Math.min(i + 1, ordered.length - 1));
      haptic("tick");
    } catch {
      setError("Save failed.");
    } finally {
      busyRef.current = false;
    }
  }, [ordered, idx]);

  const closeItem = useCallback(async () => {
    const t = ordered[idx];
    if (!t || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      const res = await fetch(`/api/todos/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completedAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error();
      setClosedTitles((c) => [...c, t.title]);
      setItems((arr) => arr.filter((x) => x.id !== t.id));
      setIdx((i) => Math.min(i, Math.max(0, ordered.length - 2)));
      haptic("success");
    } catch {
      setError("Save failed.");
    } finally {
      busyRef.current = false;
    }
  }, [ordered, idx]);

  const quickAdd = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      // A pasted Granola (or any notes) link is the meeting's notes, not a todo.
      if (/^https?:\/\/\S+$/.test(trimmed) && /granola/i.test(trimmed)) {
        setNotesUrl(trimmed);
        haptic("tick");
        return;
      }
      setError(null);
      try {
        const res = await fetch("/api/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed, listId }),
        });
        if (!res.ok) throw new Error();
        const { todo } = (await res.json()) as { todo: AgendaTodo };
        setItems((arr) => [...arr, { ...todo, discussCount: 0, lastDiscussedAt: null }]);
        setAddedTitles((a) => [...a, trimmed]);
        haptic("tick");
      } catch {
        setError("Couldn't add that.");
      }
    },
    [listId]
  );

  const recapText = useCallback(() => {
    const lines: string[] = [`${listName} — 1:1 ${new Date().toLocaleDateString()}`];
    if (notesUrl) lines.push(`Notes: ${notesUrl}`);
    if (discussedTitles.length)
      lines.push("", "Discussed:", ...discussedTitles.map((t) => `- ${t}`));
    if (closedTitles.length)
      lines.push("", "Closed:", ...closedTitles.map((t) => `- ${t}`));
    if (addedTitles.length)
      lines.push("", "New:", ...addedTitles.map((t) => `- ${t}`));
    const open = ordered.filter((t) => !discussedTitles.includes(t.title));
    if (open.length)
      lines.push("", "Still open:", ...open.map((t) => `- ${t.title}`));
    return lines.join("\n");
  }, [listName, discussedTitles, closedTitles, addedTitles, ordered, notesUrl]);

  // Keyboard: d discussed · e done · j/k nav · n quick-add · Esc close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") {
          e.stopPropagation();
          setAdding(false);
        }
        return;
      }
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "d":
          discuss();
          break;
        case "e":
          closeItem();
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setIdx((i) => Math.min(i + 1, ordered.length - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setIdx((i) => Math.max(i - 1, 0));
          break;
        case "n":
          e.preventDefault();
          setAdding(true);
          setTimeout(() => addRef.current?.focus(), 30);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, discuss, closeItem, ordered.length]);

  if (!mounted) return null;

  const isNew = (t: AgendaTodo) =>
    lastMeetingAt != null && new Date(t.createdAt).getTime() > lastMeetingAt;

  return (
    <div
      data-overlay=""
      data-state={state}
      className="fixed inset-0 z-50 bg-[var(--color-background)]/95 backdrop-blur-sm flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="size-4" /> {listName} · 1:1
          <span className="text-[var(--color-muted-foreground)] font-normal tabular-nums">
            {discussedTitles.length + closedTitles.length} covered
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {linkOpen ? (
            <input
              ref={linkRef}
              defaultValue={notesUrl ?? ""}
              placeholder="Paste Granola link…"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  const v = (e.target as HTMLInputElement).value.trim();
                  setNotesUrl(v || null);
                  setLinkOpen(false);
                  if (v) haptic("tick");
                } else if (e.key === "Escape") setLinkOpen(false);
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                setNotesUrl(v || null);
                setLinkOpen(false);
              }}
              className="w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-xs focus:border-[var(--color-ring)] focus:outline-none"
            />
          ) : notesUrl ? (
            <span className="inline-flex items-center gap-1">
              <a
                href={notesUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)]/60 px-2 py-1 text-xs hover:bg-[var(--color-accent)]"
                title={notesUrl}
              >
                <Link2 className="size-3" /> notes
              </a>
              <button
                onClick={() => {
                  setLinkOpen(true);
                  setTimeout(() => linkRef.current?.focus(), 30);
                }}
                className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                title="Change link"
              >
                <Plus className="size-3 rotate-45" />
              </button>
            </span>
          ) : (
            <button
              onClick={() => {
                setLinkOpen(true);
                setTimeout(() => linkRef.current?.focus(), 30);
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
              title="Attach meeting notes (Granola link)"
            >
              <Link2 className="size-3" /> Granola
            </button>
          )}
          <button
            onClick={close}
            className="rounded p-1.5 hover:bg-[var(--color-accent)]"
            title="End (Esc)"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {loading ? (
          <div className="grid place-items-center h-40">
            <Loader2 className="size-6 animate-spin text-[var(--color-muted-foreground)]" />
          </div>
        ) : items.length === 0 ? (
          <div className="mx-auto max-w-xl text-center pt-16">
            <Check className="size-10 mx-auto mb-3 text-[var(--color-muted-foreground)]" />
            <div className="text-title font-semibold">Nothing open</div>
          </div>
        ) : (
          <ul className="mx-auto max-w-xl space-y-1.5">
            {ordered.map((t, i) => {
              const discussedThisSession = discussedTitles.includes(t.title);
              return (
                <li key={t.id}>
                  {/* Divider before the first carryover item when new items exist */}
                  {i > 0 && isNew(ordered[i - 1]) && !isNew(t) ? (
                    <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      <span className="h-px flex-1 bg-[var(--color-border)]" />
                      carryover
                      <span className="h-px flex-1 bg-[var(--color-border)]" />
                    </div>
                  ) : null}
                  {i === 0 && isNew(t) ? (
                    <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      <span className="h-px flex-1 bg-[var(--color-border)]" />
                      new since last 1:1
                      <span className="h-px flex-1 bg-[var(--color-border)]" />
                    </div>
                  ) : null}
                  <button
                    onClick={() => setIdx(i)}
                    className={cn(
                      "w-full rounded-xl border px-4 py-3 text-left transition",
                      i === idx
                        ? "border-[var(--color-foreground)]/50 bg-[var(--color-card)]"
                        : "border-[var(--color-border)] bg-[var(--color-card)]/60",
                      discussedThisSession && "opacity-50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium break-words">
                        {t.title}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {discussedThisSession ? (
                          <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                            discussed
                          </span>
                        ) : null}
                        {t.discussCount > 0 ? (
                          <span
                            className="rounded bg-[var(--color-accent)]/60 px-1.5 py-0.5 text-[10px] tabular-nums"
                            title={`Raised in ${t.discussCount} previous meeting${t.discussCount === 1 ? "" : "s"}`}
                          >
                            raised {t.discussCount}×
                          </span>
                        ) : null}
                      </span>
                    </div>
                    {t.notes ? (
                      <div className="mt-1 text-xs text-[var(--color-muted-foreground)] line-clamp-2 whitespace-pre-wrap">
                        {t.notes}
                      </div>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {adding ? (
          <div className="mx-auto max-w-xl mt-3">
            <input
              ref={addRef}
              placeholder="Came up in the meeting…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  quickAdd((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = "";
                }
              }}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-sm focus:border-[var(--color-ring)] focus:outline-none"
            />
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="px-5 pb-2 text-center text-sm text-rose-500">{error}</div>
      ) : null}

      <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-xl flex items-center justify-center gap-1.5 flex-wrap">
          <AgendaBtn icon={MessageSquare} label="Discussed" k="d" onClick={discuss} />
          <AgendaBtn icon={Check} label="Done" k="e" onClick={closeItem} />
          <AgendaBtn
            icon={Plus}
            label="Add"
            k="n"
            onClick={() => {
              setAdding(true);
              setTimeout(() => addRef.current?.focus(), 30);
            }}
          />
          <AgendaBtn
            icon={Save}
            label={saved ? "Saved" : "Save recap"}
            k=""
            onClick={async () => {
              try {
                const res = await fetch("/api/agenda/recap", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    listName,
                    recap: recapText(),
                    notesUrl,
                  }),
                });
                if (!res.ok) throw new Error();
                setSaved(true);
                haptic("success");
                setTimeout(() => setSaved(false), 2000);
              } catch {
                setError("Couldn't save the recap.");
              }
            }}
          />
          <AgendaBtn
            icon={Copy}
            label={copied ? "Copied" : "Copy recap"}
            k=""
            onClick={async () => {
              const text = recapText();
              let ok = false;
              try {
                await navigator.clipboard.writeText(text);
                ok = true;
              } catch {
                // Permission-gated context (e.g. embedded webview): fall back
                // to the selection-based path, which works on a user gesture.
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                ok = document.execCommand("copy");
                ta.remove();
              }
              if (ok) {
                setCopied(true);
                haptic("success");
                setTimeout(() => setCopied(false), 1500);
              } else {
                setError("Clipboard unavailable.");
              }
            }}
          />
        </div>
        <p className="mt-3 hidden md:block text-center text-xs text-[var(--color-muted-foreground)]">
          d discussed · e done · n add (paste a Granola link to attach it) · j / k move
        </p>
      </div>
    </div>
  );
}

function AgendaBtn({
  icon: Icon,
  label,
  k,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  k: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm min-h-[40px] hover:bg-[var(--color-accent)]"
    >
      <Icon className="size-4" />
      {label}
      {k ? (
        <kbd className="hidden md:inline text-[10px] text-[var(--color-muted-foreground)] border border-[var(--color-border)] rounded px-1">
          {k}
        </kbd>
      ) : null}
    </button>
  );
}
