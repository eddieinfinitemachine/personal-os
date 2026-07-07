"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  Calendar,
  Check,
  CheckCircle2,
  CircleSlash,
  FolderInput,
  Hourglass,
  List as ListIcon,
  Loader2,
  Trash2,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";
import { aliasTargetsFromLists, detectAliasInTitle } from "@/lib/alias";
import { useOverlayTransition } from "@/lib/use-overlay-transition";

type TriageTodo = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  listId: string;
  projectId: string | null;
  createdAt: string;
  snoozedUntil?: string | null;
};
type ProjectOpt = { id: string; name: string };
type ListOpt = { id: string; name: string; isDefault: boolean };

type UndoEntry =
  | { kind: "patch"; todo: TriageTodo; revert: Record<string, unknown>; index: number }
  | { kind: "delete"; todo: TriageTodo; index: number };

type Picker = "project" | "list" | "date" | "snooze" | null;

export function TriageLauncher({
  projectId,
  mode = "inbox",
  staleCount,
  count,
}: {
  projectId?: string;
  mode?: "inbox" | "stale";
  staleCount?: number;
  count?: number;
}) {
  const [open, setOpen] = useState(false);

  // `t` opens triage from anywhere on the Inbox page (not while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      if (mode !== "inbox") return; // the sweep is button-only
      if (e.key !== "t" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el.isContentEditable
      )
        return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  if (mode === "stale" && !staleCount) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={mode === "inbox" ? "Triage inbox  ·  t" : "Sweep stale todos (open >14d)"}
        className={
          mode === "inbox"
            ? "inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium min-h-[36px]"
            : "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium min-h-[36px] hover:bg-[var(--color-accent)]"
        }
      >
        {mode === "inbox" ? (
          <>
            <Zap className="size-4" /> Triage
            {count ? (
              <span className="rounded bg-[var(--color-background)]/20 px-1.5 text-xs tabular-nums">
                {count}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <Hourglass className="size-4" /> Sweep
            <span className="rounded bg-[var(--color-accent)] px-1.5 text-xs tabular-nums">
              {staleCount}
            </span>
          </>
        )}
      </button>
      {open ? (
        <TriageMode projectId={projectId} mode={mode} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function TriageMode({
  projectId,
  mode = "inbox",
  onClose,
}: {
  projectId?: string;
  mode?: "inbox" | "stale";
  onClose: () => void;
}) {
  const router = useRouter();
  const { mounted, state } = useOverlayTransition(true);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<TriageTodo[]>([]);
  const [idx, setIdx] = useState(0);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [lists, setLists] = useState<ListOpt[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const undoStack = useRef<UndoEntry[]>([]);
  const touchStartX = useRef<number | null>(null);
  // One mutation at a time: action keys are ignored while a save is in flight
  // so rapid keypresses can't race the optimistic queue against the server.
  const busyRef = useRef(false);

  const current: TriageTodo | undefined = queue[idx];

  // Capture-neighborhood context for the current card, fetched lazily and
  // cached per todo id. Read-only — decodes terse fragments via siblings.
  const [contextCache, setContextCache] = useState<
    Record<string, { capturedAt: string; neighbors: { title: string; done: boolean }[] }>
  >({});
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId || contextCache[currentId]) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/todos/context?id=${currentId}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          capturedAt: string;
          neighbors: { title: string; done: boolean }[];
        };
        if (!cancelled)
          setContextCache((c) => ({ ...c, [currentId]: data }));
      } catch {
        // Context is garnish; the card works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentId, contextCache]);
  const context = currentId ? contextCache[currentId] : undefined;

  // Deterministic name-detection: a known person-list alias in the title
  // offers one-key filing ("a → EC/Shane"). Pure string match, no AI.
  const aliasSuggestion = useMemo(() => {
    if (!current) return null;
    const target = detectAliasInTitle(current.title, aliasTargetsFromLists(lists));
    if (!target || target.listId === current.listId) return null;
    return target;
  }, [current, lists]);

  // Load the queue + filing targets fresh on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tRes, pRes, lRes] = await Promise.all([
          fetch(
            mode === "stale"
              ? "/api/todos?stale=1"
              : `/api/todos?projectId=${projectId}`
          ),
          fetch("/api/projects"),
          fetch("/api/lists"),
        ]);
        if (cancelled) return;
        const { todos } = (await tRes.json()) as { todos: TriageTodo[] };
        const { projects } = (await pRes.json()) as { projects: ProjectOpt[] };
        const { lists } = (await lRes.json()) as { lists: ListOpt[] };
        setQueue(todos);
        setProjects(projects.filter((p) => p.id !== (projectId ?? "")));
        setLists(lists);
      } catch {
        if (!cancelled) setError("Couldn't load the inbox.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, mode]);

  const close = useCallback(() => {
    onClose();
    router.refresh();
  }, [onClose, router]);

  // Remove current item from the queue (optimistic), PATCH, keep undo.
  const applyToCurrent = useCallback(
    async (
      patch: Record<string, unknown>,
      revert: Record<string, unknown>,
      opts?: { keepInQueue?: boolean }
    ) => {
      const todo = queue[idx];
      if (!todo || busyRef.current) return;
      busyRef.current = true;
      setError(null);
      if (!opts?.keepInQueue) {
        undoStack.current.push({ kind: "patch", todo, revert, index: idx });
        setQueue((q) => q.filter((t) => t.id !== todo.id));
        setIdx((i) => Math.min(i, Math.max(0, queue.length - 2)));
        setDoneCount((c) => c + 1);
        haptic("tick");
      }
      try {
        const res = await fetch(`/api/todos/${todo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error();
        if (opts?.keepInQueue) {
          setQueue((q) =>
            q.map((t) =>
              t.id === todo.id ? { ...t, ...(patch as Partial<TriageTodo>) } : t
            )
          );
          haptic("tick");
        }
      } catch {
        setError("Save failed — item restored.");
        if (!opts?.keepInQueue) {
          undoStack.current.pop();
          setQueue((q) => {
            const next = [...q];
            next.splice(Math.min(idx, next.length), 0, todo);
            return next;
          });
          setDoneCount((c) => Math.max(0, c - 1));
        }
      } finally {
        busyRef.current = false;
      }
    },
    [queue, idx]
  );

  const fileToProject = useCallback(
    (p: ProjectOpt) => {
      const todo = queue[idx];
      if (!todo) return;
      setPicker(null);
      applyToCurrent({ projectId: p.id }, { projectId: todo.projectId });
    },
    [applyToCurrent, queue, idx]
  );

  const moveToList = useCallback(
    (l: ListOpt) => {
      const todo = queue[idx];
      if (!todo) return;
      setPicker(null);
      applyToCurrent({ listId: l.id }, { listId: todo.listId });
    },
    [applyToCurrent, queue, idx]
  );

  const setDate = useCallback(
    (iso: string | null) => {
      const todo = queue[idx];
      if (!todo) return;
      setPicker(null);
      applyToCurrent(
        { dueDate: iso },
        { dueDate: todo.dueDate },
        { keepInQueue: true }
      );
    },
    [applyToCurrent, queue, idx]
  );

  const complete = useCallback(() => {
    const todo = queue[idx];
    if (!todo) return;
    applyToCurrent(
      { completedAt: new Date().toISOString() },
      { completedAt: null }
    );
  }, [applyToCurrent, queue, idx]);

  const dropIt = useCallback(() => {
    if (!queue[idx]) return;
    applyToCurrent({ drop: true }, { drop: false });
  }, [applyToCurrent, queue, idx]);

  const makeReference = useCallback(() => {
    if (!queue[idx]) return;
    applyToCurrent({ reference: true }, { reference: false });
  }, [applyToCurrent, queue, idx]);

  const snooze = useCallback(
    (days: number) => {
      const todo = queue[idx];
      if (!todo) return;
      setPicker(null);
      const until = new Date(Date.now() + days * 864e5);
      until.setHours(7, 0, 0, 0);
      applyToCurrent(
        { snoozedUntil: until.toISOString() },
        { snoozedUntil: todo.snoozedUntil ?? null }
      );
    },
    [applyToCurrent, queue, idx]
  );

  const remove = useCallback(async () => {
    const todo = queue[idx];
    if (!todo || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    undoStack.current.push({ kind: "delete", todo, index: idx });
    setQueue((q) => q.filter((t) => t.id !== todo.id));
    setIdx((i) => Math.min(i, Math.max(0, queue.length - 2)));
    setDoneCount((c) => c + 1);
    haptic("tick");
    try {
      const res = await fetch(`/api/todos/${todo.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setError("Delete failed — item restored.");
      undoStack.current.pop();
      setQueue((q) => {
        const next = [...q];
        next.splice(Math.min(idx, next.length), 0, todo);
        return next;
      });
      setDoneCount((c) => Math.max(0, c - 1));
    } finally {
      busyRef.current = false;
    }
  }, [queue, idx]);

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    const entry = undoStack.current.pop();
    if (!entry) return;
    busyRef.current = true;
    try {
      await runUndo(entry);
    } finally {
      busyRef.current = false;
    }
  }, [queue.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runUndo(entry: UndoEntry) {
    setError(null);
    if (entry.kind === "patch") {
      const res = await fetch(`/api/todos/${entry.todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.revert),
      });
      if (!res.ok) {
        setError("Undo failed.");
        return;
      }
      setQueue((q) => {
        const next = [...q];
        next.splice(Math.min(entry.index, next.length), 0, entry.todo);
        return next;
      });
    } else {
      // Deleted rows are recreated (new id); attachments/subtasks don't survive.
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: entry.todo.title,
          notes: entry.todo.notes ?? undefined,
          listId: entry.todo.listId,
          projectId: entry.todo.projectId,
          dueDate: entry.todo.dueDate,
        }),
      });
      if (!res.ok) {
        setError("Undo failed.");
        return;
      }
      const { todo } = (await res.json()) as { todo: TriageTodo };
      setQueue((q) => {
        const next = [...q];
        next.splice(Math.min(entry.index, next.length), 0, todo);
        return next;
      });
    }
    setDoneCount((c) => Math.max(0, c - 1));
    setIdx(Math.min(entry.index, queue.length));
    haptic("tick");
  }

  // Keyboard map (disabled while a picker is open — pickers own the keyboard).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Held-key autorepeat must never machine-gun actions through the queue.
      if (e.repeat) return;
      if (picker) {
        if (e.key === "Escape") {
          e.stopPropagation();
          setPicker(null);
        }
        return;
      }
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setIdx((i) => Math.min(i + 1, queue.length - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setIdx((i) => Math.max(i - 1, 0));
          break;
        case "p":
          if (current) setPicker("project");
          break;
        case "l":
          if (current) setPicker("list");
          break;
        case "d":
          if (current) setPicker("date");
          break;
        case "a":
          if (aliasSuggestion) {
            const l = lists.find((x) => x.id === aliasSuggestion.listId);
            if (l) moveToList(l);
          }
          break;
        case "e":
          complete();
          break;
        case "x":
          dropIt();
          break;
        case "r":
          makeReference();
          break;
        case "s":
          if (current) setPicker("snooze");
          break;
        case "#":
        case "Delete":
          remove();
          break;
        case "u":
          undo();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picker, queue.length, current, complete, remove, undo, close, aliasSuggestion, lists, moveToList, dropIt, makeReference]);

  if (!mounted) return null;

  return (
    <div
      data-overlay=""
      data-state={state}
      className="fixed inset-0 z-50 bg-[var(--color-background)]/95 backdrop-blur-sm flex flex-col"
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) < 60) return;
        if (dx < 0) setIdx((i) => Math.min(i + 1, queue.length - 1));
        else setIdx((i) => Math.max(i - 1, 0));
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Zap className="size-4" /> Triage
          {queue.length > 0 ? (
            <span className="text-[var(--color-muted-foreground)] font-normal tabular-nums">
              {idx + 1} / {queue.length}
              {doneCount > 0 ? ` · ${doneCount} handled` : ""}
            </span>
          ) : null}
        </div>
        <button
          onClick={close}
          className="rounded p-1.5 hover:bg-[var(--color-accent)]"
          title="Close (Esc)"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Card */}
      <div className="flex-1 grid place-items-center px-5 pb-4 min-h-0">
        {loading ? (
          <Loader2 className="size-6 animate-spin text-[var(--color-muted-foreground)]" />
        ) : !current ? (
          <div className="text-center">
            <CheckCircle2 className="size-10 mx-auto mb-3 text-[var(--color-muted-foreground)]" />
            <div className="text-title font-semibold">Inbox zero</div>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              {doneCount > 0
                ? `${doneCount} item${doneCount === 1 ? "" : "s"} handled.`
                : "Nothing to triage."}
            </p>
            <button
              onClick={close}
              className="mt-5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium"
            >
              Done
            </button>
          </div>
        ) : (
          <div
            key={current.id}
            className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl p-6 animate-[fade-in-up_.25s_var(--ease-out-quart)]"
          >
            <div className="text-title font-semibold whitespace-pre-wrap break-words">
              {current.title}
            </div>
            {current.notes ? (
              <div className="mt-2 text-sm text-[var(--color-muted-foreground)] whitespace-pre-wrap break-words line-clamp-6">
                {current.notes}
              </div>
            ) : null}
            {aliasSuggestion ? (
              <button
                onClick={() => {
                  const l = lists.find((x) => x.id === aliasSuggestion.listId);
                  if (l) moveToList(l);
                }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-2.5 py-1.5 text-xs font-medium"
              >
                <kbd className="rounded border border-[var(--color-background)]/40 px-1 text-[10px]">
                  a
                </kbd>
                → {aliasSuggestion.listName}
              </button>
            ) : null}
            <div className="mt-4 flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
              <span>
                captured{" "}
                {new Date(current.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
                {(() => {
                  const d = Math.floor(
                    (Date.now() - new Date(current.createdAt).getTime()) / 864e5
                  );
                  return d >= 7 ? ` · ${d}d ago` : "";
                })()}
              </span>
              {current.dueDate ? (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="size-3" />
                  {new Date(current.dueDate).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              ) : null}
            </div>
            {context && context.neighbors.length ? (
              <div className="mt-3 border-t border-[var(--color-border)] pt-2.5 text-xs text-[var(--color-muted-foreground)]">
                <span className="font-medium">Captured alongside: </span>
                {context.neighbors.slice(0, 5).map((n, i) => (
                  <span key={i}>
                    {i > 0 ? " · " : ""}
                    <span className={n.done ? "line-through opacity-60" : undefined}>
                      {n.title.length > 32 ? n.title.slice(0, 32) + "…" : n.title}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {error ? (
        <div className="px-5 pb-2 text-center text-sm text-rose-500">{error}</div>
      ) : null}

      {/* Action row */}
      {current ? (
        <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-xl flex items-center justify-center gap-1.5 flex-wrap">
            <ActionBtn icon={FolderInput} label="Project" k="p" onClick={() => setPicker("project")} />
            <ActionBtn icon={ListIcon} label="List" k="l" onClick={() => setPicker("list")} />
            <ActionBtn icon={Calendar} label="Date" k="d" onClick={() => setPicker("date")} />
            <ActionBtn icon={Check} label="Done" k="e" onClick={complete} />
            <ActionBtn icon={CircleSlash} label="Drop" k="x" onClick={dropIt} />
            <ActionBtn icon={Bookmark} label="Ref" k="r" onClick={makeReference} />
            <ActionBtn icon={Hourglass} label="Snooze" k="s" onClick={() => setPicker("snooze")} />
            <ActionBtn icon={Trash2} label="Delete" k="#" onClick={remove} danger />
            <ActionBtn icon={Undo2} label="Undo" k="u" onClick={undo} />
          </div>
          <p className="mt-3 hidden md:block text-center text-xs text-[var(--color-muted-foreground)]">
            j / k next · prev — actions advance · x drop · r reference · s snooze
          </p>
        </div>
      ) : null}

      {/* Pickers */}
      {picker === "project" ? (
        <FuzzyPicker
          title="File to project"
          options={projects.map((p) => ({ id: p.id, label: p.name }))}
          onPick={(id) => {
            const p = projects.find((x) => x.id === id);
            if (p) fileToProject(p);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === "list" ? (
        <FuzzyPicker
          title="Move to list"
          options={lists.map((l) => ({ id: l.id, label: l.name }))}
          onPick={(id) => {
            const l = lists.find((x) => x.id === id);
            if (l) moveToList(l);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === "date" ? (
        <DatePicker onPick={setDate} onClose={() => setPicker(null)} />
      ) : null}
      {picker === "snooze" ? (
        <div
          className="absolute inset-0 z-10 grid place-items-start justify-center pt-[18vh] bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPicker(null);
          }}
        >
          <div
            data-overlay="scale"
            data-state="open"
            className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated,var(--color-card))] shadow-2xl p-3"
          >
            <div className="text-xs font-medium text-[var(--color-muted-foreground)] mb-2">
              Snooze — resurfaces at the top of its list
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <QuickBtn label="Next week" onClick={() => snooze(7)} />
              <QuickBtn label="In a month" onClick={() => snooze(30)} />
              <QuickBtn label="Someday (90d)" onClick={() => snooze(90)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  k,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  k: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm min-h-[40px]",
        danger
          ? "text-rose-500 hover:bg-rose-500/10"
          : "hover:bg-[var(--color-accent)]"
      )}
    >
      <Icon className="size-4" />
      {label}
      <kbd className="hidden md:inline text-[10px] text-[var(--color-muted-foreground)] border border-[var(--color-border)] rounded px-1">
        {k}
      </kbd>
    </button>
  );
}

export function FuzzyPicker({
  title,
  options,
  onPick,
  onClose,
}: {
  title: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 20);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options
      .filter((o) => o.label.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = a.label.toLowerCase().startsWith(needle) ? 0 : 1;
        const bStarts = b.label.toLowerCase().startsWith(needle) ? 0 : 1;
        return aStarts - bStarts || a.label.localeCompare(b.label);
      });
  }, [q, options]);

  return (
    <div
      className="absolute inset-0 z-10 grid place-items-start justify-center pt-[18vh] bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-overlay="scale"
        data-state="open"
        className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated,var(--color-card))] shadow-2xl overflow-hidden"
      >
        <div className="px-3 pt-3 pb-1 text-xs font-medium text-[var(--color-muted-foreground)]">
          {title}
        </div>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[hi]) onPick(filtered[hi].id);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder="Type to filter…"
          className="w-full bg-transparent px-3 py-2 text-sm focus:outline-none border-b border-[var(--color-border)]"
        />
        <ul className="max-h-60 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
              No matches
            </li>
          ) : (
            filtered.map((o, i) => (
              <li key={o.id}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(o.id);
                  }}
                  onMouseEnter={() => setHi(i)}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-sm",
                    i === hi && "bg-[var(--color-accent)]/60"
                  )}
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function DatePicker({
  onPick,
  onClose,
}: {
  onPick: (iso: string | null) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 20);
  }, []);

  function quick(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    onPick(d.toISOString());
  }

  return (
    <div
      className="absolute inset-0 z-10 grid place-items-start justify-center pt-[18vh] bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-overlay="scale"
        data-state="open"
        className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated,var(--color-card))] shadow-2xl p-3"
      >
        <div className="text-xs font-medium text-[var(--color-muted-foreground)] mb-2">
          Due date
        </div>
        <div className="flex gap-1.5 flex-wrap mb-2">
          <QuickBtn label="Today" onClick={() => quick(0)} />
          <QuickBtn label="Tomorrow" onClick={() => quick(1)} />
          <QuickBtn label="Next week" onClick={() => quick(7)} />
          <QuickBtn label="Clear" onClick={() => onPick(null)} />
        </div>
        <input
          ref={inputRef}
          type="date"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              const v = (e.target as HTMLInputElement).value;
              if (v) onPick(new Date(`${v}T09:00:00`).toISOString());
            } else if (e.key === "Escape") onClose();
          }}
          onChange={(e) => {
            if (e.target.value)
              onPick(new Date(`${e.target.value}T09:00:00`).toISOString());
          }}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:outline-none focus:border-[var(--color-ring)]"
        />
      </div>
    </div>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md bg-[var(--color-accent)]/60 px-2.5 py-1.5 text-xs hover:bg-[var(--color-accent)]"
    >
      {label}
    </button>
  );
}
