"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { haptic } from "@/lib/haptic";
import { pushUndo, quoteTitle, requestUndo } from "@/lib/undo";
import { FuzzyPicker } from "./fuzzy-picker";

// Email-style keyboard navigation over the todo rows on the page:
//   j / k  — move the highlight through every visible open todo
//   l      — file the highlighted todo to a list (fuzzy picker; "ben" ⏎ → EC/Ben)
//   p      — file to a project
//   e      — complete
//   u      — undo the last action (same stack as ⌘Z; see lib/undo.ts)
//   Esc    — clear the highlight
// Rows are discovered from the DOM ([data-kbd-todo]) so this works across
// tiles and project cards without threading state through them.

type Option = { id: string; label: string };

export function KeyboardListNav() {
  const router = useRouter();
  const [picker, setPicker] = useState<null | "list" | "project">(null);
  const [lists, setLists] = useState<Option[] | null>(null);
  const [projects, setProjects] = useState<Option[] | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const [copied, setCopied] = useState<number | null>(null);

  const applySelection = useCallback((ids: Set<string>) => {
    // Sweep stale marks first — a row can lose data-kbd-todo (completed,
    // re-rendered) while still carrying the selected attribute.
    for (const el of document.querySelectorAll<HTMLElement>("[data-kbd-selected]")) {
      if (!ids.has(el.dataset.kbdTodo ?? "")) delete el.dataset.kbdSelected;
    }
    for (const el of document.querySelectorAll<HTMLElement>("[data-kbd-todo]")) {
      if (ids.has(el.dataset.kbdTodo!) && el.getClientRects().length > 0) {
        el.dataset.kbdSelected = "true";
      } else {
        delete el.dataset.kbdSelected;
      }
    }
  }, []);

  const toggleSelected = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        applySelection(next);
        return next;
      });
    },
    [applySelection]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    applySelection(new Set());
    anchorRef.current = null;
  }, [applySelection]);

  // Shift-click range: everything between the anchor and the clicked row,
  // inclusive, in on-screen order.
  const rangeSelect = useCallback(
    (fromId: string, toId: string) => {
      const order = rows().map((el) => el.dataset.kbdTodo!);
      const a = order.indexOf(fromId);
      const b = order.indexOf(toId);
      if (a === -1 || b === -1) return;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(order[i]);
        applySelection(next);
        return next;
      });
      // Shift-click also spawns a browser text selection — clear it so ⌘C
      // copies the tasks, not stray page text.
      window.getSelection()?.removeAllRanges();
    },
    [applySelection]
  );

  const copySelection = useCallback(async () => {
    const ids = selectedRef.current;
    const targets =
      ids.size > 0
        ? [...ids]
        : activeIdRef.current
          ? [activeIdRef.current]
          : [];
    if (targets.length === 0) return;
    // Preserve on-screen order.
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>("[data-kbd-todo]")) {
      const id = el.dataset.kbdTodo!;
      if (!targets.includes(id) || seen.has(id)) continue;
      if (el.getClientRects().length === 0) continue;
      seen.add(id);
      ordered.push(el.dataset.kbdTitle ?? "");
    }
    const text = ordered.filter(Boolean).map((t) => `- ${t}`).join("\n");
    if (!text) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    if (ok) {
      haptic("success");
      setCopied(ordered.length);
      setTimeout(() => setCopied(null), 1600);
      // Copy is the end of the gesture — drop the selection.
      setSelectedIds(new Set());
      for (const el of document.querySelectorAll<HTMLElement>("[data-kbd-selected]")) {
        delete el.dataset.kbdSelected;
      }
      anchorRef.current = null;
    }
  }, []);

  const rows = () => {
    // The same todo renders multiple times (hidden mobile layout, tile,
    // By-Project card). Only VISIBLE instances count — the hidden mobile
    // clone comes first in the DOM and highlighting it shows nothing
    // (that bug cost three rounds of debugging; check pixels, not DOM).
    const seen = new Set<string>();
    const out: HTMLElement[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[data-kbd-todo]")) {
      if (el.getClientRects().length === 0) continue; // display:none ancestor
      const id = el.dataset.kbdTodo!;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(el);
    }
    return out;
  };

  const setActive = useCallback((id: string | null) => {
    let marked = false;
    for (const el of document.querySelectorAll<HTMLElement>("[data-kbd-todo]")) {
      const visible = el.getClientRects().length > 0;
      if (el.dataset.kbdTodo === id && visible && !marked) {
        el.dataset.kbdActive = "true";
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        marked = true;
      } else {
        delete el.dataset.kbdActive;
      }
    }
    activeIdRef.current = id;
  }, []);

  // After an action removes a row from view, land the highlight on the row
  // below it — or the one above when it was last (move(1) clamps in place
  // there, stranding the highlight on a row about to vanish).
  const advanceFrom = useCallback(
    (id: string) => {
      const all = rows();
      const idx = all.findIndex((el) => el.dataset.kbdTodo === id);
      if (idx === -1) return;
      const next = all[idx + 1] ?? all[idx - 1] ?? null;
      setActive(next?.dataset.kbdTodo ?? null);
    },
    [setActive]
  );

  // Clicking a row selects it, so j/k continue from where the mouse was.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Synthetic clicks (complete() clicking the row's checkbox) must not
      // steal the highlight back onto the row that's about to disappear.
      if (!e.isTrusted) return;
      const row = (e.target as HTMLElement).closest?.<HTMLElement>("[data-kbd-todo]");
      if (!row || row.getClientRects().length === 0) return;
      const id = row.dataset.kbdTodo!;
      // A real click on the checkbox completes the row — advance off it
      // instead of making a vanishing row the active one.
      if ((e.target as HTMLElement).closest?.('button[title="Mark complete"]')) {
        if (id === activeIdRef.current) advanceFrom(id);
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const from = anchorRef.current ?? activeIdRef.current ?? id;
        rangeSelect(from, id);
        setActive(id);
        return;
      }
      if (e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleSelected(id);
        anchorRef.current = id;
        setActive(id);
        return;
      }
      anchorRef.current = id;
      if (id !== activeIdRef.current) setActive(id);
    }
    // Suppress the browser's shift-click text selection over rows.
    function onMouseDown(e: MouseEvent) {
      if (!e.shiftKey) return;
      if ((e.target as HTMLElement).closest?.("[data-kbd-todo]")) e.preventDefault();
    }
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("mousedown", onMouseDown, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("mousedown", onMouseDown, { capture: true });
    };
  }, [setActive, toggleSelected, rangeSelect, advanceFrom]);

  // Re-apply the highlight after router.refresh() re-renders the rows.
  // Must mark the VISIBLE instance — the first DOM match is the hidden
  // mobile clone, and marking it leaves the highlight invisible.
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const id = activeIdRef.current;
      if (!id) return;
      let marked = false;
      for (const el of document.querySelectorAll<HTMLElement>(
        `[data-kbd-todo="${id}"]`
      )) {
        if (!marked && el.getClientRects().length > 0) {
          if (el.dataset.kbdActive !== "true") el.dataset.kbdActive = "true";
          marked = true;
        } else if (el.dataset.kbdActive) {
          delete el.dataset.kbdActive;
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const move = useCallback(
    (dir: 1 | -1) => {
      const all = rows();
      if (!all.length) return;
      const idx = all.findIndex((el) => el.dataset.kbdTodo === activeIdRef.current);
      // No live selection → always start at the top of the first list,
      // regardless of direction.
      const next =
        idx === -1 ? 0 : Math.min(Math.max(idx + dir, 0), all.length - 1);
      setActive(all[next].dataset.kbdTodo ?? null);
    },
    [setActive]
  );

  const ensureOptions = useCallback(async (kind: "list" | "project") => {
    if (kind === "list" && !lists) {
      const res = await fetch("/api/lists");
      if (res.ok) {
        const { lists } = (await res.json()) as { lists: { id: string; name: string }[] };
        setLists(lists.map((l) => ({ id: l.id, label: l.name })));
      }
    }
    if (kind === "project" && !projects) {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const { projects } = (await res.json()) as { projects: { id: string; name: string }[] };
        setProjects(projects.map((p) => ({ id: p.id, label: p.name })));
      }
    }
  }, [lists, projects]);

  const patch = useCallback(
    async (todoId: string, body: Record<string, unknown>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const res = await fetch(`/api/todos/${todoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          haptic("tick");
          // Move the highlight before this row disappears from the view.
          advanceFrom(todoId);
          router.refresh();
        }
      } finally {
        busyRef.current = false;
      }
    },
    [router, advanceFrom]
  );

  const complete = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    // Click the VISIBLE row's own checkbox so the native completion
    // choreography plays instantly (the first DOM match is a hidden mobile
    // clone whose checkbox updates a different component's state — clicking
    // it made completion feel delayed).
    const row = [
      ...document.querySelectorAll<HTMLElement>(`[data-kbd-todo="${id}"]`),
    ].find((el) => el.getClientRects().length > 0);
    const checkbox = row?.querySelector<HTMLButtonElement>(
      'button[title="Mark complete"]'
    );
    if (checkbox) {
      // The tile owns this path (choreography + its own undo registration).
      advanceFrom(id);
      checkbox.click();
      haptic("tick");
    } else {
      const title = row?.dataset.kbdTitle ?? "task";
      void patch(id, { completedAt: new Date().toISOString() }).then(() => {
        pushUndo({
          label: `Completed ${quoteTitle(title)}`,
          run: () => patch(id, { completedAt: null }),
        });
      });
    }
  }, [patch, advanceFrom]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      // ⌘N: open the New Reminder composer — on the highlighted row's list,
      // else the first visible list tile. (Replaces desktop click-to-compose.)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        const active = document.querySelector<HTMLElement>("[data-kbd-active=true]");
        const listId =
          active?.dataset.kbdList ??
          document.querySelector<HTMLElement>("[data-kbd-todo]")?.dataset.kbdList;
        if (listId) {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("personalos:start-add-todo", { detail: { listId } })
          );
        }
        return;
      }
      // ⌘C with an active multi-selection (and no text selected on the page).
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "c" &&
        selectedRef.current.size > 0 &&
        (window.getSelection()?.isCollapsed ?? true)
      ) {
        e.preventDefault();
        void copySelection();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (picker) return; // picker owns the keyboard
      const el = e.target as HTMLElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        el.isContentEditable
      )
        return;
      // A full-screen overlay (triage, 1:1, capture drawer) owns the keys.
      if (document.querySelector("[data-overlay]")) return;

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      switch (key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          // Shift extends the selection through the rows it passes.
          if (e.shiftKey && activeIdRef.current) {
            setSelectedIds((prev) => {
              const next = new Set(prev).add(activeIdRef.current!);
              applySelection(next);
              return next;
            });
          }
          move(1);
          if (e.shiftKey && activeIdRef.current) toggleSelectedInclude(activeIdRef.current);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          if (e.shiftKey && activeIdRef.current) {
            setSelectedIds((prev) => {
              const next = new Set(prev).add(activeIdRef.current!);
              applySelection(next);
              return next;
            });
          }
          move(-1);
          if (e.shiftKey && activeIdRef.current) toggleSelectedInclude(activeIdRef.current);
          break;
        case "v":
          if (activeIdRef.current) {
            toggleSelected(activeIdRef.current);
            anchorRef.current = activeIdRef.current;
          }
          break;
        case "c":
          void copySelection();
          break;
        case "l":
          if (activeIdRef.current) {
            void ensureOptions("list");
            setPicker("list");
          }
          break;
        case "p":
          if (activeIdRef.current) {
            void ensureOptions("project");
            setPicker("project");
          }
          break;
        case "e":
          complete();
          break;
        case "u":
          requestUndo();
          break;
        case "Escape":
          if (selectedRef.current.size > 0) clearSelection();
          else setActive(null);
          break;
      }
    }
    function toggleSelectedInclude(id: string) {
      setSelectedIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev).add(id);
        applySelection(next);
        return next;
      });
    }
    // Capture phase: real keypresses reach us before any in-page handler
    // can stop propagation (inputs/overlays are still respected above).
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [picker, move, complete, ensureOptions, setActive, toggleSelected, clearSelection, copySelection, applySelection]);

  const pill =
    copied != null ? (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-[var(--color-foreground)] text-[var(--color-background)] px-3.5 py-1.5 text-xs font-medium shadow-lg">
        Copied {copied} task{copied === 1 ? "" : "s"}
      </div>
    ) : selectedIds.size > 0 ? (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-[var(--color-foreground)] text-[var(--color-background)] px-3.5 py-1.5 text-xs font-medium shadow-lg">
        {selectedIds.size} selected · c copy · Esc clear
      </div>
    ) : null;

  if (!picker) return pill;
  const options = picker === "list" ? lists : projects;
  return (
    <div className="fixed inset-0 z-50">
      {pill}
      <FuzzyPicker
        title={picker === "list" ? "Move to list" : "File to project"}
        options={options ?? []}
        onPick={(targetId) => {
          const todoId = activeIdRef.current;
          setPicker(null);
          if (!todoId) return;
          // Ride the row's own optimistic move (instant, same as drag) —
          // the row PATCHes the server itself, and registers the undo.
          advanceFrom(todoId);
          window.dispatchEvent(
            new CustomEvent("personalos:kbd-move", {
              detail: {
                todoId,
                kind: picker,
                targetId,
              },
            })
          );
          haptic("tick");
        }}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}
