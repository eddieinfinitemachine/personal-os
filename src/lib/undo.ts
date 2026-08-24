// Global undo stack (⌘Z). Any mutating action registers the inverse of what
// it just did; the newest registration wins.
//
// Deliberately a module singleton rather than a React context: the callers
// are hot paths (every todo row, every tile) that only ever *write* to the
// stack — a context would re-render all of them whenever the stack changed.
// Only <UndoHost> subscribes.
//
// Each entry's `run` is a closure created inside the component that made the
// change, so it can put that component's own optimistic state back (a row
// hidden by a completion, a deleted row's placeholder) *and* issue the
// server call — the same shape the forward action used.

export type UndoEntry = {
  // Past-tense description of the action being reversed: "Completed “Buy
  // milk”". Rendered in the pill as-is.
  label: string;
  run: () => Promise<void> | void;
  at: number;
};

export type UndoChange = "push" | "pop" | "clear";
type Listener = (change: UndoChange) => void;

const MAX_DEPTH = 25;
// An undo offered an hour later is a surprise, not a convenience. Entries
// older than this are skipped (and dropped) when ⌘Z reaches them.
const MAX_AGE_MS = 15 * 60_000;

const stack: UndoEntry[] = [];
const listeners = new Set<Listener>();

function emit(change: UndoChange) {
  for (const fn of listeners) fn(change);
}

export function subscribeUndo(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pushUndo(entry: Omit<UndoEntry, "at">) {
  stack.push({ ...entry, at: Date.now() });
  if (stack.length > MAX_DEPTH) stack.shift();
  emit("push");
}

/** Newest still-valid entry, without removing it (for the pill's label). */
export function peekUndo(): UndoEntry | null {
  prune();
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** Newest still-valid entry, removed from the stack. */
export function popUndo(): UndoEntry | null {
  prune();
  const entry = stack.pop() ?? null;
  if (entry) emit("pop");
  return entry;
}

export function clearUndo() {
  if (stack.length === 0) return;
  stack.length = 0;
  emit("clear");
}

// Drops stale entries off the top. Silent by design — it runs inside
// peekUndo(), and emitting from there would re-enter listeners mid-notify.
function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  while (stack.length > 0 && stack[stack.length - 1].at < cutoff) stack.pop();
}

// The single place that actually runs an undo lives in <UndoHost> (it owns
// the pill and the in-flight guard). Other key handlers — keyboard-nav's `u`
// — ask for one through here instead of duplicating that logic.
let runner: (() => void) | null = null;

export function setUndoRunner(fn: () => void): () => void {
  runner = fn;
  return () => {
    if (runner === fn) runner = null;
  };
}

export function requestUndo() {
  runner?.();
}

/** Title in the pill's quotes, trimmed so long todos don't blow out the row. */
export function quoteTitle(title: string, max = 32): string {
  const t = title.trim();
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;
}
