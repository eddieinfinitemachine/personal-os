"use client";

import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// Mobile "+" — multi-action.
//   tap        → open the active pager list's inline add input.
//   long-press → navigate to /capture (smart capture flow).
//
// Press feedback: button slightly squishes (95%), and a soft pulse ring
// expands behind it over the 500ms hold. Haptics fire in stages so the
// long-press feels intentional, not accidental:
//   0ms  : tiny tick (5)
//   250ms: medium tick (12) — "you've held it"
//   500ms: thunk pattern   — long-press fired
// iOS chrome (text selection, magnifier, tap-highlight) is suppressed so
// the only feedback is the one we drive ourselves.
const LONG_PRESS_MS = 500;
const MID_PRESS_MS = 250;

export function MobileFab() {
  const router = useRouter();
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  const [fired, setFired] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const midPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  useEffect(() => {
    function onActiveList(e: Event) {
      const ev = e as CustomEvent<{ listId: string }>;
      setActiveListId(ev.detail?.listId ?? null);
    }
    window.addEventListener("personalos:active-list", onActiveList);
    window.dispatchEvent(new Event("personalos:request-active-list"));
    return () =>
      window.removeEventListener("personalos:active-list", onActiveList);
  }, []);

  // Clear any pending timers on unmount.
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (midPressTimer.current) clearTimeout(midPressTimer.current);
      if (firedPulseTimer.current) clearTimeout(firedPulseTimer.current);
    };
  }, []);

  function vibrate(pattern: number | number[]) {
    try {
      (navigator as Navigator & { vibrate?: (p: number | number[]) => void }).vibrate?.(pattern);
    } catch {}
  }

  function clearTimers() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (midPressTimer.current) {
      clearTimeout(midPressTimer.current);
      midPressTimer.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    // Suppress iOS magnifier / context menu on long-press.
    e.preventDefault();
    longPressFired.current = false;
    setFired(false);
    setPressing(true);
    clearTimers();
    vibrate(5);
    midPressTimer.current = setTimeout(() => vibrate(12), MID_PRESS_MS);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setFired(true);
      setPressing(false);
      vibrate([30, 40, 18]);
      // Let the "fired" pulse render for a moment before navigating.
      firedPulseTimer.current = setTimeout(() => {
        setFired(false);
        router.push("/capture");
      }, 110);
    }, LONG_PRESS_MS);
  }

  function endPress() {
    clearTimers();
    setPressing(false);
  }

  function quickReminder() {
    if (!activeListId) return;
    window.dispatchEvent(
      new CustomEvent("personalos:start-add-todo", {
        detail: { listId: activeListId },
      }),
    );
    vibrate(8);
  }

  function onClick() {
    // If the long-press already fired, swallow the synthetic click.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    quickReminder();
  }

  return (
    <button
      onPointerDown={onPointerDown}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label="New reminder (long-press for capture)"
      disabled={!activeListId}
      className={cn(
        "md:hidden fixed right-4 bottom-[calc(56px+env(safe-area-inset-bottom)+18px)] z-30",
        "relative grid place-items-center size-14 rounded-full",
        "bg-[var(--color-tint)] text-white",
        "shadow-[0_10px_24px_-6px_color-mix(in_oklab,var(--color-tint),transparent_30%),0_2px_6px_rgba(0,0,0,0.25)]",
        "transition-transform duration-150 ease-out",
        // Suppress iOS chrome we don't want.
        "select-none touch-manipulation",
        "[-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none]",
        // Press / fire state — only one applies at a time.
        fired
          ? "scale-110"
          : pressing
            ? "scale-95"
            : "active:scale-90",
        !activeListId && "opacity-50",
      )}
    >
      {/* Soft pulse ring — fills over the 500ms hold, then bursts on fire. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-full bg-white",
          "transition-all ease-out",
          fired
            ? "scale-[1.9] opacity-0 duration-200"
            : pressing
              ? "scale-[1.35] opacity-25 duration-[500ms]"
              : "scale-100 opacity-0 duration-150",
        )}
      />
      <Plus className="relative z-10 size-7" strokeWidth={2.5} />
    </button>
  );
}
