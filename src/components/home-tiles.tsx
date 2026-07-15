"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListTile, type ListInfo } from "./list-tile";
import { palette } from "@/lib/lists";
import { haptic } from "@/lib/haptic";
import { cn } from "@/lib/utils";
import type { TodoLike } from "./todo-row";

export type HomeTile = {
  list: ListInfo;
  todos: TodoLike[];
  totalCount: number;
};

export function HomeTiles({ tiles: initialTiles }: { tiles: HomeTile[] }) {
  const router = useRouter();
  const [tiles, setTiles] = useState(initialTiles);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync from server snapshots (e.g. todo counts updating).
  useEffect(() => {
    setTiles(initialTiles);
  }, [initialTiles]);

  // Optimistic listing for newly-created lists. NewListButton dispatches
  // this event after the create POST succeeds — we append a placeholder tile
  // so the user sees the new list immediately. The subsequent refresh
  // replaces it with the server snapshot.
  useEffect(() => {
    function onCreated(ev: Event) {
      const e = ev as CustomEvent<{
        list: { id: string; name: string; color: string; isDefault: boolean };
      }>;
      if (!e.detail?.list) return;
      setTiles((prev) => {
        if (prev.some((t) => t.list.id === e.detail.list.id)) return prev;
        return [
          ...prev,
          { list: e.detail.list, todos: [], totalCount: 0 },
        ];
      });
    }
    window.addEventListener("personalos:list-created", onCreated);
    return () =>
      window.removeEventListener("personalos:list-created", onCreated);
  }, []);

  const orderedIds = useMemo(() => tiles.map((t) => t.list.id), [tiles]);

  function moveTile(fromId: string, toId: string) {
    if (fromId === toId) return;
    setTiles((prev) => {
      const fromIdx = prev.findIndex((t) => t.list.id === fromId);
      const toIdx = prev.findIndex((t) => t.list.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  async function persistOrder() {
    setDraggingId(null);
    setOverId(null);
    await fetch("/api/lists/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: orderedIds }),
    });
    startTransition(() => router.refresh());
  }

  // Mobile pager: horizontal scroll-snap track with a segmented tab indicator.
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRafRef = useRef<number | null>(null);

  function onTrackScroll() {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const t = trackRef.current;
      if (!t) return;
      const width = t.clientWidth;
      if (width === 0) return;
      const idx = Math.round(t.scrollLeft / width);
      setActiveIdx((prev) => (prev === idx ? prev : idx));
    });
  }

  function scrollToIdx(i: number) {
    const t = trackRef.current;
    if (!t) return;
    t.scrollTo({ left: i * t.clientWidth, behavior: "smooth" });
  }

  // Mobile drawer "Lists" taps: the drawer stores the target list id and
  // fires this event. Handled here (not via URL hash) because Next's Link
  // pushState never fires hashchange, and sessionStorage survives the
  // cross-page case where Home mounts after the tap.
  useEffect(() => {
    const go = () => {
      const id = sessionStorage.getItem("personalos:goto-list");
      if (!id) return;
      const idx = tiles.findIndex((t) => t.list.id === id);
      if (idx < 0) return;
      sessionStorage.removeItem("personalos:goto-list");
      scrollToIdx(idx);
    };
    go();
    window.addEventListener("personalos:goto-list", go);
    return () => window.removeEventListener("personalos:goto-list", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles]);

  // Broadcast the currently visible pager list so MobileFab can target its
  // inline add input. Re-emit on demand so a late-mounting MobileFab can ask.
  useEffect(() => {
    const activeList = tiles[activeIdx]?.list;
    if (!activeList) return;
    window.dispatchEvent(
      new CustomEvent("personalos:active-list", {
        detail: { listId: activeList.id },
      })
    );
  }, [activeIdx, tiles]);

  useEffect(() => {
    function onRequest() {
      const activeList = tiles[activeIdx]?.list;
      if (!activeList) return;
      window.dispatchEvent(
        new CustomEvent("personalos:active-list", {
          detail: { listId: activeList.id },
        })
      );
    }
    window.addEventListener("personalos:request-active-list", onRequest);
    return () =>
      window.removeEventListener("personalos:request-active-list", onRequest);
  }, [activeIdx, tiles]);

  return (
    <>
      {/* Mobile: scrollable pill bar (one chip per list with count) + pager. */}
      <div className="md:hidden">
        <div className="mb-3 -mx-4 px-4 flex gap-1.5 overflow-x-auto scrollbar-none">
          {tiles.map((t, i) => {
            const p = palette(t.list.color);
            const active = activeIdx === i;
            return (
              <button
                key={t.list.id}
                onClick={() => {
                  haptic("tick");
                  scrollToIdx(i);
                }}
                aria-label={`Go to ${t.list.name}`}
                className={cn(
                  "pressable shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium tabular-nums transition-colors",
                  active
                    ? "bg-[var(--color-accent)] text-[var(--color-foreground)] ring-1 ring-[var(--color-foreground)]/10"
                    : "text-[var(--color-muted-foreground)]"
                )}
              >
                <span aria-hidden className={cn("size-2 rounded-full", p.dot)} />
                <span className="whitespace-nowrap">{t.list.name}</span>
                <span className="tabular-nums opacity-70">{t.totalCount}</span>
              </button>
            );
          })}
        </div>

        <div
          ref={trackRef}
          onScroll={onTrackScroll}
          data-pager-track
          className="flex -mx-4 overflow-x-auto snap-x snap-mandatory scrollbar-none"
          style={{
            scrollSnapStop: "always",
            overscrollBehaviorX: "contain",
          }}
        >
          {tiles.map((t) => (
            <div
              key={t.list.id}
              className="snap-start shrink-0 w-screen px-4"
            >
              <ListTile
                list={t.list}
                todos={t.todos}
                totalCount={t.totalCount}
                groupByProject
              />
            </div>
          ))}
        </div>
      </div>

      {/* Desktop: grid (drag-to-reorder tiles is desktop-only). */}
      <div className="hidden md:grid gap-4 grid-cols-1 lg:grid-cols-3">
        {tiles.map((t) => (
          <ListTile
            key={t.list.id}
            list={t.list}
            todos={t.todos}
            totalCount={t.totalCount}
            reorderable
            groupByProject
            onReorderStart={(id) => setDraggingId(id)}
            onReorderOver={(id) => {
              if (!draggingId || draggingId === id) return;
              if (overId === id) return;
              setOverId(id);
              moveTile(draggingId, id);
            }}
            onReorderDrop={() => {
              persistOrder();
            }}
          />
        ))}
      </div>
    </>
  );
}
