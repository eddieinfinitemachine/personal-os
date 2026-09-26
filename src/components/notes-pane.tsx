"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, FileText, PanelLeft, Plus, SquarePen, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatEditedAt,
  formatRowDate,
  groupNotesByRecency,
  isFocusShortcut,
  notePreview,
} from "@/lib/notes-ui";

export type NoteData = {
  id: string;
  title: string | null;
  body: string;
  updatedAt: Date | string;
};

// Apple Notes-style split view: a notes list beside the editor on wide
// screens, a list → editor navigation stack on narrow ones (HIG: split views
// collapse in compact widths). Focus mode hides the app sidebar, the notes
// list, and the page chrome, leaving only the editor at reading width.

const FOCUS_KEY = "personalos:notes-focus";
const FOCUS_ATTR = "data-notes-focus";
// Set for a couple of frames when focus mode is restored on load so the
// sidebar snaps closed instead of animating shut on every page view.
const INSTANT_ATTR = "data-notes-focus-instant";

function useNotesFocusMode(available: boolean) {
  const [focus, setFocus] = useState(false);

  // Restore the saved preference after hydration (localStorage isn't
  // readable during SSR).
  useEffect(() => {
    let saved = false;
    try {
      saved = window.localStorage.getItem(FOCUS_KEY) === "1";
    } catch {
      // Private mode / blocked storage: default to off.
    }
    if (!saved) return;
    const root = document.documentElement;
    root.setAttribute(INSTANT_ATTR, "");
    setFocus(true);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => root.removeAttribute(INSTANT_ATTR));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      root.removeAttribute(INSTANT_ATTR);
    };
  }, []);

  const setPersisted = useCallback((next: boolean) => {
    setFocus(next);
    try {
      window.localStorage.setItem(FOCUS_KEY, next ? "1" : "0");
    } catch {
      // Non-fatal: the toggle still works for this page view.
    }
  }, []);

  const active = focus && available;

  // The global sidebar, mobile top bar, and project header react to this
  // attribute via CSS (globals.css). Removed on unmount so leaving the Notes
  // tab never strands another page without its chrome.
  useEffect(() => {
    const root = document.documentElement;
    if (active) root.setAttribute(FOCUS_ATTR, "");
    else root.removeAttribute(FOCUS_ATTR);
    return () => root.removeAttribute(FOCUS_ATTR);
  }, [active]);

  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!available) return;
    function onKey(e: KeyboardEvent) {
      if (isFocusShortcut(e)) {
        e.preventDefault();
        setPersisted(!activeRef.current);
        return;
      }
      if (
        e.key === "Escape" &&
        activeRef.current &&
        !e.defaultPrevented &&
        // An open overlay (palette, capture drawer, modal) owns Escape.
        !document.querySelector("[data-overlay]")
      ) {
        setPersisted(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [available, setPersisted]);

  return { focus: active, setFocus: setPersisted };
}

// Dates depend on the viewer's timezone, so they render only after mount;
// the server (UTC) and browser would otherwise disagree and break hydration.
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function NotesPane({
  projectId,
  notes,
}: {
  projectId: string;
  notes: NoteData[];
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(notes[0]?.id ?? null);
  // Compact widths: which side of the navigation stack is showing.
  const [mobileView, setMobileView] = useState<"list" | "editor">("list");
  // A just-created note, shown before router.refresh() delivers it.
  const [optimistic, setOptimistic] = useState<NoteData | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();
  const now = useNow();

  const allNotes = useMemo(
    () =>
      optimistic && !notes.some((n) => n.id === optimistic.id)
        ? [optimistic, ...notes]
        : notes,
    [notes, optimistic]
  );
  const active = allNotes.find((n) => n.id === activeId) ?? null;
  const { focus, setFocus } = useNotesFocusMode(active !== null);
  const splitRef = useRef<HTMLDivElement>(null);

  // Compact navigation swaps list and editor in place; if the list was
  // scrolled, bring the top of the new view back on screen (a pushed view
  // starts at its top). The 56px clears the fixed mobile top bar.
  useEffect(() => {
    const el = splitRef.current;
    if (!el || window.matchMedia("(min-width: 1024px)").matches) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0) window.scrollBy({ top: top - 56 });
  }, [mobileView]);

  async function createNote() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: "", body: "" }),
      });
      if (res.ok) {
        const { note } = (await res.json()) as { note: NoteData };
        setOptimistic(note);
        setActiveId(note.id);
        setJustCreatedId(note.id);
        setMobileView("editor");
        startTransition(() => router.refresh());
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteNote(id: string) {
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (!res.ok) return false;
    if (activeId === id) {
      // Like Apple Notes: select the next note down, else the one above.
      const idx = allNotes.findIndex((n) => n.id === id);
      const remaining = allNotes.filter((n) => n.id !== id);
      setActiveId((remaining[idx] ?? remaining[idx - 1])?.id ?? null);
      setMobileView("list");
    }
    if (optimistic?.id === id) setOptimistic(null);
    startTransition(() => router.refresh());
    return true;
  }

  function selectNote(id: string) {
    setActiveId(id);
    setMobileView("editor");
  }

  if (allNotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] px-6 py-16 text-center">
        <FileText
          className="mb-4 size-10 text-[var(--color-label-tertiary)]"
          strokeWidth={1.5}
          aria-hidden
        />
        <h2 className="text-title font-semibold">No Notes</h2>
        <p className="mt-1 max-w-xs text-sm text-[var(--color-label-secondary)]">
          Capture plans, calls, and ideas for this project. Notes save as you type.
        </p>
        <button
          type="button"
          onClick={createNote}
          disabled={creating}
          className="pressable mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--color-foreground)] px-4 text-sm font-medium text-[var(--color-background)] hover:opacity-90 disabled:opacity-60 md:min-h-9"
        >
          <Plus className="size-4" aria-hidden /> New Note
        </button>
      </div>
    );
  }

  const listVisibleCompact = !focus && mobileView === "list";
  const editorVisibleCompact = focus || mobileView === "editor";

  return (
    <div
      ref={splitRef}
      data-notes-split
      className={cn(
        "grid grid-cols-1 lg:overflow-hidden lg:rounded-xl lg:border",
        "lg:h-[calc(100dvh-12rem)] lg:min-h-[28rem]",
        "transition-[grid-template-columns,border-color,background-color,height] duration-300 ease-spring motion-reduce:transition-none",
        focus
          ? "lg:h-[calc(100dvh-3rem)] lg:grid-cols-[0rem_minmax(0,1fr)] lg:border-transparent lg:bg-[var(--color-background)]"
          : "lg:grid-cols-[18rem_minmax(0,1fr)] lg:border-[var(--color-card-border)] lg:bg-[var(--color-card)]"
      )}
    >
      <NotesList
        notes={allNotes}
        activeId={activeId}
        now={now}
        onSelect={selectNote}
        onCreate={createNote}
        creating={creating}
        className={cn(
          listVisibleCompact ? "flex" : "hidden",
          "lg:flex",
          // Collapsed column: invisible also drops it from the tab order.
          focus && "lg:invisible lg:opacity-0"
        )}
      />
      <section
        aria-label="Note"
        className={cn(
          "min-w-0 flex-col",
          editorVisibleCompact ? "flex" : "hidden",
          "lg:flex lg:min-h-0"
        )}
      >
        {active ? (
          <NoteEditor
            key={active.id}
            note={active}
            now={now}
            autoFocusTitle={active.id === justCreatedId}
            focus={focus}
            onToggleFocus={() => setFocus(!focus)}
            onBack={() => setMobileView("list")}
            onCreate={createNote}
            creating={creating}
            onDelete={() => deleteNote(active.id)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--color-label-secondary)]">
            Select a note
          </div>
        )}
      </section>
    </div>
  );
}

function NotesList({
  notes,
  activeId,
  now,
  onSelect,
  onCreate,
  creating,
  className,
}: {
  notes: NoteData[];
  activeId: string | null;
  now: Date | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  creating: boolean;
  className?: string;
}) {
  // Before mount there's no reliable local "now": one unlabeled group.
  const groups = now ? groupNotesByRecency(notes, now) : [{ label: "", notes }];

  // Up/Down move through notes and open them, like a macOS source list.
  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-note-row]")
    );
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = rows[e.key === "ArrowDown" ? i + 1 : i - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
    onSelect(next.dataset.noteRow!);
  }

  return (
    <aside
      aria-label="Notes"
      className={cn(
        "min-w-0 flex-col overflow-hidden transition-[opacity,visibility] duration-200 motion-reduce:transition-none",
        "rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]",
        "lg:rounded-none lg:border-0 lg:border-r lg:border-[var(--color-separator)] lg:bg-transparent",
        className
      )}
    >
      <div className="flex min-h-14 items-center justify-between gap-2 pl-4 pr-2">
        <div className="min-w-0">
          <h2 className="text-headline font-semibold">Notes</h2>
          <p className="text-caption text-[var(--color-label-secondary)]">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </p>
        </div>
        <IconButton label="New note" onClick={onCreate} disabled={creating}>
          <SquarePen className="size-[18px]" strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onKeyDown={onKeyDown}>
        {groups.map((g) => (
          <section key={g.label || "all"} aria-label={g.label || undefined}>
            {g.label ? (
              <h3 className="sticky top-0 z-10 bg-[var(--color-card)] px-2 pb-1 pt-3 text-subhead font-semibold text-[var(--color-label-secondary)]">
                {g.label}
              </h3>
            ) : null}
            <ul>
              {g.notes.map((n, i) => {
                const isActive = n.id === activeId;
                // Hairline between rows, hidden next to the selection
                // (Apple list convention).
                const prevActive = i > 0 && g.notes[i - 1].id === activeId;
                const showSeparator = i > 0 && !isActive && !prevActive;
                const preview = notePreview(n.body);
                return (
                  <li key={n.id} className="relative">
                    {showSeparator ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-3 top-0 h-px bg-[var(--color-separator)]"
                      />
                    ) : null}
                    <button
                      type="button"
                      data-note-row={n.id}
                      onClick={() => onSelect(n.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "block min-h-11 w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
                        isActive
                          ? "bg-[var(--color-accent)]"
                          : "hover:bg-[var(--color-fill-secondary)]"
                      )}
                    >
                      <div
                        className={cn(
                          "truncate text-headline font-semibold",
                          !n.title && "text-[var(--color-label-secondary)]"
                        )}
                      >
                        {n.title || "New Note"}
                      </div>
                      <div className="mt-0.5 flex min-w-0 gap-2 text-subhead">
                        {now ? (
                          <span className="shrink-0 tabular-nums text-[var(--color-foreground)]/80">
                            {formatRowDate(new Date(n.updatedAt), now)}
                          </span>
                        ) : null}
                        <span className="truncate text-[var(--color-label-secondary)]">
                          {preview || "No additional text"}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

function IconButton({
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        // 44pt touch target on phones; 36px with a desktop pointer.
        "pressable grid size-11 shrink-0 place-items-center rounded-lg text-[var(--color-label-secondary)] transition-colors hover:bg-[var(--color-fill)] hover:text-[var(--color-foreground)] disabled:opacity-50 md:size-9",
        className
      )}
    >
      {children}
    </button>
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function NoteEditor({
  note,
  now,
  autoFocusTitle,
  focus,
  onToggleFocus,
  onBack,
  onCreate,
  creating,
  onDelete,
}: {
  note: NoteData;
  now: Date | null;
  autoFocusTitle: boolean;
  focus: boolean;
  onToggleFocus: () => void;
  onBack: () => void;
  onCreate: () => void;
  creating: boolean;
  onDelete: () => Promise<boolean>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title ?? "");
  const [body, setBody] = useState(note.body);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shortcut, setShortcut] = useState("Ctrl+\\");

  // What the server last acknowledged. Edits are diffed against it so a
  // re-run effect (StrictMode, refresh) never sends a no-op PATCH.
  const savedRef = useRef({ title: note.title ?? "", body: note.body });
  const latestRef = useRef({ title, body });
  latestRef.current = { title, body };
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("⌘\\");
  }, []);

  const save = useCallback(
    async (opts?: { keepalive?: boolean }) => {
      const snapshot = { ...latestRef.current };
      const saved = savedRef.current;
      if (snapshot.title === saved.title && snapshot.body === saved.body) return;
      setStatus("saving");
      try {
        const res = await fetch(`/api/notes/${note.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshot),
          keepalive: opts?.keepalive,
        });
        if (!res.ok) throw new Error(String(res.status));
        savedRef.current = snapshot;
        const l = latestRef.current;
        // Only report "Saved" if nothing changed while the request flew.
        setStatus(l.title === snapshot.title && l.body === snapshot.body ? "saved" : "saving");
        router.refresh();
      } catch {
        setStatus("error");
      }
    },
    [note.id, router]
  );

  // Debounced autosave.
  useEffect(() => {
    const saved = savedRef.current;
    if (title === saved.title && body === saved.body) return;
    setStatus("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), 600);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [title, body, save]);

  // Flush a pending edit when switching notes or leaving the page, so typing
  // and immediately clicking another note never drops the last keystrokes.
  useEffect(() => {
    const flush = () => void save({ keepalive: true });
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save]);

  // "Saved" is transient; the quiet steady state shows nothing at all.
  useEffect(() => {
    if (status !== "saved") return;
    const id = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(id);
  }, [status]);

  useEffect(() => {
    if (autoFocusTitle) titleRef.current?.focus();
  }, [autoFocusTitle]);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  // Grow the textarea with its content so the pane (not the field) scrolls,
  // and re-measure when the column width changes (focus mode, resize).
  const autosize = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(autosize, [body, autosize]);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth;
        autosize();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [autosize]);

  async function confirmDelete() {
    setDeleting(true);
    // Don't let the unmount flush resurrect edits on a deleted note.
    savedRef.current = { ...latestRef.current };
    if (timerRef.current) clearTimeout(timerRef.current);
    const ok = await onDelete();
    if (!ok) {
      setDeleting(false);
      setConfirming(false);
      setStatus("error");
    }
  }

  const statusText =
    status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar: navigation on the leading edge, actions trailing. */}
      <div
        className={cn(
          "flex min-h-14 items-center gap-1 px-2",
          !focus && "lg:border-b lg:border-[var(--color-separator)]"
        )}
      >
        {!focus ? (
          <button
            type="button"
            onClick={onBack}
            className="pressable -ml-1 inline-flex min-h-11 items-center gap-0.5 rounded-lg pl-1 pr-2 text-[17px] text-[var(--color-foreground)] hover:bg-[var(--color-fill)] lg:hidden"
          >
            <ChevronLeft className="size-6" strokeWidth={2} aria-hidden />
            Notes
          </button>
        ) : null}
        <IconButton
          label={focus ? "Show sidebars" : "Hide sidebars"}
          shortcut={shortcut}
          onClick={onToggleFocus}
          pressed={focus}
        >
          <PanelLeft className="size-[18px]" strokeWidth={1.75} />
        </IconButton>

        <div className="ml-auto flex items-center gap-1">
          {confirming ? (
            <div
              role="group"
              aria-label="Confirm delete"
              className="flex animate-scale-in items-center gap-1.5"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Cancel the confirm without also leaving focus mode.
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirming(false);
                }
              }}
            >
              <span className="hidden pr-1 text-sm text-[var(--color-label-secondary)] sm:inline">
                Delete this note?
              </span>
              <button
                ref={cancelRef}
                type="button"
                onClick={() => setConfirming(false)}
                className="pressable min-h-11 rounded-lg bg-[var(--color-fill)] px-3 text-sm font-medium md:min-h-8"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="pressable min-h-11 rounded-lg bg-[var(--color-destructive)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 md:min-h-8"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          ) : (
            <>
              <span
                role="status"
                aria-live="polite"
                className={cn(
                  "px-2 text-caption tabular-nums transition-opacity duration-300",
                  status === "error"
                    ? "text-[var(--color-destructive)]"
                    : "text-[var(--color-label-tertiary)]",
                  statusText || status === "error" ? "opacity-100" : "opacity-0"
                )}
              >
                {status === "error" ? (
                  <button
                    type="button"
                    onClick={() => void save()}
                    className="underline-offset-2 hover:underline"
                  >
                    Couldn’t save · Retry
                  </button>
                ) : (
                  statusText
                )}
              </span>
              {focus ? (
                <IconButton label="New note" onClick={onCreate} disabled={creating}>
                  <SquarePen className="size-[18px]" strokeWidth={1.75} />
                </IconButton>
              ) : null}
              <IconButton
                label="Delete note"
                onClick={() => setConfirming(true)}
                className="hover:text-[var(--color-destructive)]"
              >
                <Trash2 className="size-[18px]" strokeWidth={1.75} />
              </IconButton>
            </>
          )}
        </div>
      </div>

      {/* Content: centered at a ~65-character measure. */}
      <div
        className="min-h-0 flex-1 cursor-text overflow-y-auto"
        onClick={(e) => {
          // Clicking the empty canvas below the text focuses the body.
          if (e.target === e.currentTarget) bodyRef.current?.focus();
        }}
      >
        <article className="mx-auto w-full max-w-[65ch] px-5 pb-24 pt-4 text-[17px] sm:px-8 lg:pt-8">
          <p
            className="mb-3 min-h-[1.125rem] text-center text-subhead text-[var(--color-label-tertiary)]"
            aria-hidden={!now}
          >
            {now ? formatEditedAt(new Date(note.updatedAt)) : null}
          </p>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              // Return in the title moves to the body, like Apple Notes.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                bodyRef.current?.focus();
              }
            }}
            placeholder="Title"
            aria-label="Note title"
            data-note-title
            className="w-full bg-transparent text-large-title font-bold placeholder:text-[var(--color-label-quaternary)] focus:outline-none"
          />
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Start writing…"
            aria-label="Note body"
            data-note-body
            rows={8}
            className="mt-3 block w-full resize-none overflow-hidden bg-transparent leading-[1.6] tracking-[-0.01em] placeholder:text-[var(--color-label-quaternary)] focus:outline-none"
          />
        </article>
      </div>
    </div>
  );
}
