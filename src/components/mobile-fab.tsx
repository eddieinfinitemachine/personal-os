"use client";

import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// Mobile "+" — multi-action.
//   tap        → open the active pager list's inline add input (current behavior).
//   long-press → navigate to /capture (smart capture flow).
//
// HomeTiles broadcasts the active list ID via the personalos:active-list
// window event; on tap we dispatch personalos:start-add-todo with that ID.
const LONG_PRESS_MS = 500;

export function MobileFab() {
  const router = useRouter();
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  useEffect(() => {
    function onActiveList(e: Event) {
      const ev = e as CustomEvent<{ listId: string }>;
      setActiveListId(ev.detail?.listId ?? null);
    }
    window.addEventListener("personalos:active-list", onActiveList);
    // Ask HomeTiles to re-broadcast in case it dispatched before we mounted.
    window.dispatchEvent(new Event("personalos:request-active-list"));
    return () =>
      window.removeEventListener("personalos:active-list", onActiveList);
  }, []);

  function vibrate(ms: number) {
    try {
      (navigator as Navigator & { vibrate?: (n: number) => void }).vibrate?.(ms);
    } catch {}
  }

  function clearTimer() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function onPointerDown() {
    longPressFired.current = false;
    setPressing(true);
    clearTimer();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      vibrate(20);
      router.push("/capture");
    }, LONG_PRESS_MS);
  }

  function endPress() {
    clearTimer();
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
      onClick={onClick}
      aria-label="New reminder (long-press for capture)"
      disabled={!activeListId}
      className={cn(
        "md:hidden fixed right-4 bottom-[calc(56px+env(safe-area-inset-bottom)+18px)] z-30",
        "grid place-items-center size-14 rounded-full",
        "bg-[var(--color-tint)] text-white",
        "shadow-[0_10px_24px_-6px_color-mix(in_oklab,var(--color-tint),transparent_30%),0_2px_6px_rgba(0,0,0,0.25)]",
        "transition-transform duration-150 ease-out",
        pressing ? "scale-95" : "active:scale-90",
        !activeListId && "opacity-50",
      )}
    >
      <Plus className="size-7" strokeWidth={2.5} />
    </button>
  );
}
