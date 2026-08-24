"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { haptic } from "@/lib/haptic";
import { peekUndo, popUndo, setUndoRunner, subscribeUndo } from "@/lib/undo";

// ⌘Z (⌃Z on Windows/Linux) runs the newest entry on the undo stack. Mounted
// once in the signed-in shell; every mutating action registers its inverse
// via pushUndo(). The pill doubles as discovery ("⌘Z to undo") and as the
// touch affordance, since phones have no ⌘Z.

const HINT_MS = 5000;
const CONFIRM_MS = 2200;

type Pill =
  | { kind: "hint"; label: string }
  | { kind: "done"; label: string }
  | { kind: "empty" }
  | { kind: "failed" };

export function UndoHost() {
  const [pill, setPill] = useState<Pill | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  const show = useCallback((next: Pill, ms: number) => {
    setPill(next);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setPill(null), ms);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  // A push means something undoable just happened — surface the offer.
  // Pops are announced by runUndo itself, so only "push" opens the hint.
  useEffect(
    () =>
      subscribeUndo((change) => {
        if (change !== "push") return;
        const top = peekUndo();
        if (top) show({ kind: "hint", label: top.label }, HINT_MS);
      }),
    [show],
  );

  const runUndo = useCallback(async () => {
    if (busyRef.current) return;
    const entry = popUndo();
    if (!entry) {
      show({ kind: "empty" }, CONFIRM_MS);
      return;
    }
    busyRef.current = true;
    // Optimistic: the entry's own rollback has already repainted the UI by
    // the time its fetch settles, so confirm immediately and only correct
    // course if the server refuses.
    show({ kind: "done", label: entry.label }, CONFIRM_MS);
    haptic("tick");
    try {
      await entry.run();
    } catch {
      show({ kind: "failed" }, CONFIRM_MS);
    } finally {
      busyRef.current = false;
    }
  }, [show]);

  // keyboard-nav's `u` runs the same undo through this registration.
  useEffect(() => setUndoRunner(() => void runUndo()), [runUndo]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "z") return;
      // Inside a text field ⌘Z belongs to the field — undoing a todo action
      // out from under someone mid-sentence would be worse than useless.
      const el = e.target as HTMLElement | null;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el?.isContentEditable
      )
        return;
      e.preventDefault();
      void runUndo();
    }
    // Capture phase, matching keyboard-nav: reach the key before any in-page
    // handler can stop propagation.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [runUndo]);

  if (!pill) return null;

  return (
    <div
      data-undo-pill={pill.kind}
      className="fixed left-1/2 -translate-x-1/2 z-50 bottom-[calc(env(safe-area-inset-bottom)+18px)] md:bottom-6 print:hidden"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-full bg-[var(--color-foreground)] text-[var(--color-background)] px-3.5 py-1.5 text-xs font-medium shadow-lg">
        {pill.kind === "hint" ? (
          <>
            <span className="max-w-[60vw] truncate">{pill.label}</span>
            <button
              onClick={() => void runUndo()}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)]/15 px-2 py-0.5 hover:bg-[var(--color-background)]/25 transition"
            >
              <Undo2 className="size-3" />
              Undo
              <span className="hidden md:inline opacity-60">⌘Z</span>
            </button>
          </>
        ) : pill.kind === "done" ? (
          <span className="max-w-[75vw] truncate">Undone · {pill.label}</span>
        ) : pill.kind === "empty" ? (
          <span>Nothing to undo</span>
        ) : (
          <span>Couldn&apos;t undo that</span>
        )}
      </div>
    </div>
  );
}
