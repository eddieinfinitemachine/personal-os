"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Entrance/exit lifecycle for overlays (modals, drawers, sheets).
 *
 * Entrance is pure CSS via @starting-style (see [data-overlay] rules in
 * globals.css). This hook only solves React's exit problem: keep the node
 * mounted with data-state="closed" for `exitMs` so the close transition can
 * play, then unmount. Reopening during the exit cancels the pending unmount,
 * keeping the overlay interruptible.
 */
export function useOverlayTransition(open: boolean, exitMs = 250) {
  const [mounted, setMounted] = useState(open);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setMounted(true);
      return;
    }
    timer.current = window.setTimeout(() => setMounted(false), exitMs);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [open, exitMs]);

  return { mounted, state: (open ? "open" : "closed") as "open" | "closed" };
}
