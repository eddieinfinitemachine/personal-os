"use client";

import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";

// Mobile "+" — multi-action.
//   tap        → open the active pager list's inline add input.
//   long-press → navigate to /capture (smart capture flow).
//
// Haptics are staged so the long-press feels intentional, not accidental.
// iOS chrome (text selection, magnifier, tap-highlight color) is suppressed
// via CSS, NOT JS — calling e.preventDefault() in onPointerDown blocks the
// synthetic click on iOS and breaks the tap.
const LONG_PRESS_MS = 500;
const MID_PRESS_MS = 250;

export function MobileFab() {
  const router = useRouter();
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const midPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (midPressTimer.current) clearTimeout(midPressTimer.current);
    };
  }, []);

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

  function onPointerDown() {
    longPressFired.current = false;
    setPressing(true);
    clearTimers();
    haptic("tick");
    midPressTimer.current = setTimeout(() => haptic("press"), MID_PRESS_MS);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setPressing(false);
      haptic("success");
      // Small delay so the haptic + final pulse register before unmount.
      setTimeout(() => router.push("/capture"), 120);
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
    haptic("tick");
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
        "grid place-items-center size-14 rounded-full",
        "bg-[var(--color-tint)] text-white",
        "shadow-[0_10px_24px_-6px_color-mix(in_oklab,var(--color-tint),transparent_30%),0_2px_6px_rgba(0,0,0,0.25)]",
        "transition-transform duration-150 ease-out",
        "select-none touch-manipulation",
        "[-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none]",
        pressing ? "scale-95" : "active:scale-90",
        !activeListId && "opacity-50",
      )}
    >
      <Plus className="size-7" strokeWidth={2.5} />
    </button>
  );
}
