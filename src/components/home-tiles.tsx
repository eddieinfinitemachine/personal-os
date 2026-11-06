"use client";

import { useEffect, useRef, useState } from "react";
import { ListTile, type ListInfo } from "./list-tile";
import { palette } from "@/lib/lists";
import { CallSheetShortcut, useCallSheetProgress } from "./call-sheet-shortcut";
import { haptic } from "@/lib/haptic";
import { cn } from "@/lib/utils";
import type { TodoLike } from "./todo-row";

// Phone pager columns. A column is the full screen on a phone and 400px once the
// screen is wider, so the unfolded iPhone Duo (951px) shows about 2.4 lists side
// by side and scrolls sideways; the folded 382px screen still shows one per swipe.
// JS reads the rendered column width (offsetWidth), so the 400 lives only in
// these class strings (the snap-stop breakpoint is "wider than one column").
const COLUMN_CLASS = "w-[min(100vw,400px)]";
// Lets the last list scroll to the leftmost column (0 wide on a phone).
const SPACER_CLASS = "w-[calc(100vw-min(100vw,400px))]";
// One column per screen: a fling stops at the next list. Several on screen: a
// fling may pass several lists, like any horizontal row.
const SNAP_STOP_CLASS =
  "[scroll-snap-stop:always] min-[401px]:[scroll-snap-stop:normal]";

export type HomeTile = {
  list: ListInfo;
  todos: TodoLike[];
  totalCount: number;
};

export function HomeTiles({ tiles: initialTiles }: { tiles: HomeTile[] }) {
  const callSheetProgress = useCallSheetProgress();
  const callSheet = (list: ListInfo) => list.isDefault && !list.shared && list.name === "To Do"
    ? <CallSheetShortcut progress={callSheetProgress} />
    : null;
  const [tiles, setTiles] = useState(initialTiles);

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

  // Mobile pager: horizontal scroll-snap track with a segmented tab indicator.
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRafRef = useRef<number | null>(null);

  // Width of one pager column as rendered (0 before layout or when hidden).
  function columnWidth() {
    const first = trackRef.current?.firstElementChild as HTMLElement | null;
    return first?.offsetWidth ?? 0;
  }

  // The active list is the leftmost snapped column.
  function onTrackScroll() {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const t = trackRef.current;
      const width = columnWidth();
      if (!t || width === 0) return;
      const idx = Math.max(
        0,
        Math.min(Math.round(t.scrollLeft / width), tiles.length - 1)
      );
      setActiveIdx((prev) => (prev === idx ? prev : idx));
    });
  }

  function scrollToIdx(i: number) {
    const t = trackRef.current;
    if (!t) return;
    t.scrollTo({ left: i * columnWidth(), behavior: "smooth" });
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
      {/* Mobile: scrollable pill bar (one chip per list with count) + pager.
          Both bleed to the screen edge by cancelling the page gutter
          (px-4, sm:px-6 in app/page.tsx), so the track is exactly the screen
          width. Lists sit side by side as columns (see COLUMN_CLASS); a
          trailing spacer lets the last one become the leftmost. */}
      <div className="md:hidden">
        <div className="mb-3 -mx-4 px-4 sm:-mx-6 sm:px-6 flex gap-1.5 overflow-x-auto scrollbar-none">
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
          className="flex -mx-4 sm:-mx-6 overflow-x-auto snap-x snap-mandatory scrollbar-none"
          style={{ overscrollBehaviorX: "contain" }}
        >
          {tiles.map((t, i) => (
            <div
              key={t.list.id}
              data-pager-column
              className={cn(
                "snap-start shrink-0 px-4 sm:px-6",
                COLUMN_CLASS,
                SNAP_STOP_CLASS,
                // Chrome-less tiles need a hairline once two share the screen.
                i > 0 && "border-l border-[var(--color-separator)]"
              )}
            >
              <ListTile
                list={t.list}
                todos={t.todos}
                totalCount={t.totalCount}
                leadingContent={callSheet(t.list)}
              />
            </div>
          ))}
          <div aria-hidden data-pager-spacer className={cn("shrink-0", SPACER_CLASS)} />
        </div>
      </div>

      {/* Desktop: grid. */}
      <div className="hidden md:grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <ListTile
            key={t.list.id}
            list={t.list}
            todos={t.todos}
            totalCount={t.totalCount}
            leadingContent={callSheet(t.list)}
          />
        ))}
      </div>
    </>
  );
}
