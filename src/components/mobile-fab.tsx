"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Mobile "+" — opens the active pager list's inline add input. No drawer.
// HomeTiles broadcasts the active list ID via the personalos:active-list
// window event; on tap we dispatch personalos:start-add-todo with that ID,
// which list-tile.tsx listens for.
export function MobileFab() {
  const [activeListId, setActiveListId] = useState<string | null>(null);

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

  function trigger() {
    if (!activeListId) return;
    window.dispatchEvent(
      new CustomEvent("personalos:start-add-todo", {
        detail: { listId: activeListId },
      })
    );
    try {
      (navigator as Navigator & { vibrate?: (n: number) => void }).vibrate?.(8);
    } catch {}
  }

  return (
    <button
      onClick={trigger}
      aria-label="New reminder"
      disabled={!activeListId}
      className={cn(
        "md:hidden fixed right-4 bottom-[calc(56px+env(safe-area-inset-bottom)+18px)] z-30",
        "grid place-items-center size-14 rounded-full",
        "bg-[var(--color-tint)] text-white",
        "shadow-[0_10px_24px_-6px_color-mix(in_oklab,var(--color-tint),transparent_30%),0_2px_6px_rgba(0,0,0,0.25)]",
        "active:scale-90 transition-transform duration-150 ease-out",
        !activeListId && "opacity-50"
      )}
    >
      <Plus className="size-7" strokeWidth={2.5} />
    </button>
  );
}
