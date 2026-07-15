"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { haptic } from "@/lib/haptic";
import { FuzzyPicker } from "./triage-mode";

// Email-style keyboard navigation over the todo rows on the page:
//   j / k  — move the highlight through every visible open todo
//   l      — file the highlighted todo to a list (fuzzy picker; "ben" ⏎ → EC/Ben)
//   p      — file to a project
//   e      — complete
//   u      — undo the last action
//   Esc    — clear the highlight
// Rows are discovered from the DOM ([data-kbd-todo]) so this works across
// tiles and project cards without threading state through them.

type Option = { id: string; label: string };
type LastAction =
  | { kind: "complete"; todoId: string }
  | { kind: "list"; todoId: string; prevListId: string }
  | { kind: "project"; todoId: string; prevProjectId: string | null };

export function KeyboardListNav() {
  const router = useRouter();
  const [picker, setPicker] = useState<null | "list" | "project">(null);
  const [lists, setLists] = useState<Option[] | null>(null);
  const [projects, setProjects] = useState<Option[] | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const lastActionRef = useRef<LastAction | null>(null);
  const busyRef = useRef(false);

  const rows = () => {
    // The same todo can render twice (list tile + By-Project card); keep the
    // first occurrence so j/k visits each todo once.
    const seen = new Set<string>();
    const out: HTMLElement[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[data-kbd-todo]")) {
      const id = el.dataset.kbdTodo!;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(el);
    }
    return out;
  };

  const setActive = useCallback((id: string | null) => {
    let scrolled = false;
    for (const el of document.querySelectorAll<HTMLElement>("[data-kbd-todo]")) {
      if (el.dataset.kbdTodo === id && !scrolled) {
        el.dataset.kbdActive = "true";
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        scrolled = true;
      } else {
        delete el.dataset.kbdActive;
      }
    }
    activeIdRef.current = id;
  }, []);

  // Re-apply the highlight after router.refresh() re-renders the rows.
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const id = activeIdRef.current;
      if (!id) return;
      const el = document.querySelector<HTMLElement>(`[data-kbd-todo="${id}"]`);
      if (el && el.dataset.kbdActive !== "true") el.dataset.kbdActive = "true";
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const move = useCallback(
    (dir: 1 | -1) => {
      const all = rows();
      if (!all.length) return;
      const idx = all.findIndex((el) => el.dataset.kbdTodo === activeIdRef.current);
      const next =
        idx === -1
          ? dir === 1
            ? 0
            : all.length - 1
          : Math.min(Math.max(idx + dir, 0), all.length - 1);
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
    async (todoId: string, body: Record<string, unknown>, undo: LastAction | null) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const res = await fetch(`/api/todos/${todoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          if (undo) lastActionRef.current = undo;
          haptic("tick");
          // Move the highlight before this row disappears from the view.
          move(1);
          router.refresh();
        }
      } finally {
        busyRef.current = false;
      }
    },
    [router, move]
  );

  const complete = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    // Click the row's own checkbox so the native completion choreography
    // plays (circle fills, row lingers, then collapses) instead of the row
    // just vanishing on refresh.
    const row = document.querySelector<HTMLElement>(`[data-kbd-todo="${id}"]`);
    const checkbox = row?.querySelector<HTMLButtonElement>(
      'button[title="Mark complete"]'
    );
    if (checkbox) {
      lastActionRef.current = { kind: "complete", todoId: id };
      move(1);
      checkbox.click();
      haptic("tick");
    } else {
      patch(id, { completedAt: new Date().toISOString() }, { kind: "complete", todoId: id });
    }
  }, [patch, move]);

  const undo = useCallback(() => {
    const a = lastActionRef.current;
    if (!a) return;
    lastActionRef.current = null;
    if (a.kind === "complete") patch(a.todoId, { completedAt: null }, null);
    else if (a.kind === "list") patch(a.todoId, { listId: a.prevListId }, null);
    else patch(a.todoId, { projectId: a.prevProjectId }, null);
  }, [patch]);

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

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
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
          undo();
          break;
        case "Escape":
          setActive(null);
          break;
      }
    }
    // Capture phase: real keypresses reach us before any in-page handler
    // can stop propagation (inputs/overlays are still respected above).
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [picker, move, complete, undo, ensureOptions, setActive]);

  if (!picker) return null;
  const options = picker === "list" ? lists : projects;
  return (
    <div className="fixed inset-0 z-50">
      <FuzzyPicker
        title={picker === "list" ? "Move to list" : "File to project"}
        options={options ?? []}
        onPick={(targetId) => {
          const todoId = activeIdRef.current;
          setPicker(null);
          if (!todoId) return;
          const row = document.querySelector<HTMLElement>(
            `[data-kbd-todo="${todoId}"]`
          );
          if (picker === "list") {
            const prevListId = row?.dataset.kbdList ?? "";
            patch(
              todoId,
              { listId: targetId },
              prevListId
                ? { kind: "list", todoId, prevListId }
                : null
            );
          } else {
            patch(todoId, { projectId: targetId }, null);
          }
        }}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}
