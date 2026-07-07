"use client";

import { memo, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { palette } from "@/lib/lists";
import { cn, formatCalendarDate, toDateInputValue, isCalendarDateOverdue } from "@/lib/utils";
import { linkify } from "@/lib/linkify";
import { getLists, getProjects } from "@/lib/todo-menu-cache";
import { TodoDetailModal } from "./todo-detail-modal";
import {
  ContextMenuPopover,
  useContextMenu,
  type AnyMenuEntry,
} from "./context-menu";

export type TodoLike = {
  id: string;
  title: string;
  notes?: string | null;
  dueDate?: Date | string | null;
  completedAt?: Date | string | null;
  projectId?: string | null;
  projectName?: string | null;
  // Display name of whoever created the todo. Surfaced as "added by …" only
  // on collaborative (shared) lists — see `showCreator`.
  creatorName?: string | null;
  // Comment thread counts. commentCount drives the bubble; unreadCommentCount
  // (others' comments since you last opened the thread) drives the badge.
  commentCount?: number;
  unreadCommentCount?: number;
  createdAt?: Date | string | null;
  snoozedUntil?: Date | string | null;
  subtasks?: TodoLike[];
};

function TodoRowImpl({
  todo,
  onToggle,
  onToggleSubtask,
  onAddSubtask,
  onSaveDueDate,
  onDelete,
  listColor = "zinc",
  sourceListId,
  sourceProjectId = null,
  showProjectBadge,
  showCreator,
  isSubtask,
  leaving,
}: {
  todo: TodoLike;
  onToggle?: (id: string) => void;
  onToggleSubtask?: (subtaskId: string) => void;
  onAddSubtask?: (parentId: string, title: string) => Promise<void> | void;
  // Optimistic mutation callbacks. When provided, the parent owns the
  // optimistic state and the row stays out of the network path. When absent,
  // the row falls back to the local fetch + router.refresh() flow.
  onSaveDueDate?: (id: string, value: string | null) => void;
  onDelete?: (id: string) => void;
  listColor?: string;
  sourceListId?: string;
  sourceProjectId?: string | null;
  showProjectBadge?: React.ReactNode;
  // When true (collaborative list), render the creator's name on the row.
  showCreator?: boolean;
  isSubtask?: boolean;
  // Completion choreography: the row is mid-collapse and about to be hidden
  // by the parent (see list-tile.tsx leavingIds).
  leaving?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const completed = todo.completedAt != null;
  const due = todo.dueDate ? new Date(todo.dueDate) : null;
  const isOverdue = due ? isCalendarDateOverdue(due) && !completed : false;
  const p = palette(listColor);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.title);
  const [optimisticTitle, setOptimisticTitle] = useState<string | null>(null);
  const displayTitle = optimisticTitle ?? todo.title;
  const [editingDate, setEditingDate] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [subDraft, setSubDraft] = useState("");
  const [subsExpanded, setSubsExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const subInputRef = useRef<HTMLInputElement>(null);
  const subtasks = todo.subtasks ?? [];
  const hasSubs = subtasks.length > 0;
  // Completed subtasks drop out of the inline list (mirroring how completed
  // top-level todos leave these tiles). The full list — including completed
  // ones — still flows to the detail modal so they can be un-checked there.
  const visibleSubtasks = subtasks.filter((s) => s.completedAt == null);

  useEffect(() => {
    if (!editing) setDraft(todo.title);
  }, [todo.title, editing]);

  useEffect(() => {
    if (optimisticTitle && todo.title === optimisticTitle) {
      setOptimisticTitle(null);
    }
  }, [todo.title, optimisticTitle]);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    }
  }, [editing]);

  async function save() {
    const next = draft.trim();
    if (!next || next === (optimisticTitle ?? todo.title)) {
      setEditing(false);
      setDraft(optimisticTitle ?? todo.title);
      return;
    }
    setEditing(false);
    setOptimisticTitle(next);
    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        setOptimisticTitle(null);
        setDraft(todo.title);
      }
      // Skip router.refresh — the optimistic title is durable until the next
      // natural refresh (navigation, parent mutation, etc.).
    } catch {
      setOptimisticTitle(null);
      setDraft(todo.title);
    }
  }

  function cancelEdit() {
    setDraft(todo.title);
    setEditing(false);
  }

  async function saveDueDate(value: string | null) {
    setEditingDate(false);
    if (onSaveDueDate) {
      onSaveDueDate(todo.id, value);
      return;
    }
    await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: value }),
    });
    startTransition(() => router.refresh());
  }

  useEffect(() => {
    if (editingDate) {
      dateRef.current?.focus();
      dateRef.current?.showPicker?.();
    }
  }, [editingDate]);

  useEffect(() => {
    if (addingSub) subInputRef.current?.focus();
  }, [addingSub]);

  // Enter handler hides the input; the resulting onBlur fires submitSubtask
  // again with a stale closure (subDraft hasn't visually cleared yet),
  // creating a duplicate. Ref short-circuits the second call.
  const submittingSubRef = useRef(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const linkifiedTitle = useMemo(
    () => linkify(displayTitle, (e) => e.stopPropagation()),
    [displayTitle],
  );
  async function submitSubtask() {
    if (submittingSubRef.current) return;
    const t = subDraft.trim();
    if (!t) {
      setAddingSub(false);
      return;
    }
    submittingSubRef.current = true;
    setSubDraft("");
    setAddingSub(false);
    try {
      await onAddSubtask?.(todo.id, t);
    } finally {
      submittingSubRef.current = false;
    }
  }

  // Right-click / long-press context menu.
  const ctx = useContextMenu();
  const [availableLists, setAvailableLists] = useState<
    { id: string; name: string; color: string }[]
  >([]);
  useEffect(() => {
    if (!ctx.isOpen || availableLists.length > 0) return;
    getLists()
      .then((lists) => setAvailableLists(lists))
      .catch(() => {});
  }, [ctx.isOpen, availableLists.length]);

  async function deleteSelf() {
    if (onDelete) {
      onDelete(todo.id);
      return;
    }
    await fetch(`/api/todos/${todo.id}`, { method: "DELETE" });
    router.refresh();
  }
  async function moveToList(listId: string) {
    // Optimistic: source tile hides this todo via the event; the destination
    // tile inserts it (new !isInTileNow && willBeInTile branch in the
    // listener). Carrying the full todo + projectName means the destination
    // can render the row before router.refresh lands.
    if (sourceListId && sourceListId !== listId) {
      window.dispatchEvent(
        new CustomEvent("personalos:todo-moved", {
          detail: {
            todoId: todo.id,
            fromListId: sourceListId,
            fromProjectId: sourceProjectId,
            toListId: listId,
            toProjectId: sourceProjectId,
            toProjectName: todo.projectName ?? null,
            todo: { ...todo, completedAt: todo.completedAt ?? null },
          },
        }),
      );
    }
    fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listId }),
    }).then((res) => {
      if (res.ok) startTransition(() => router.refresh());
    });
  }

  // Project picker (mobile + desktop edit row). Rendered via portal at the
  // body level with position computed from the chip's bounding rect — keeps
  // it from being constrained by row overflow or weird ancestor positioning.
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectPickerPos, setProjectPickerPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [availableProjects, setAvailableProjects] = useState<
    { id: string; name: string }[]
  >([]);
  const projectPickerNeedsLoad =
    (projectPickerOpen || ctx.isOpen) && availableProjects.length === 0;
  useEffect(() => {
    if (!projectPickerNeedsLoad) return;
    getProjects()
      .then((projects) => setAvailableProjects(projects))
      .catch(() => {});
  }, [projectPickerNeedsLoad]);
  useEffect(() => {
    if (!projectPickerOpen) {
      setProjectPickerPos(null);
      return;
    }
    function onDown(e: MouseEvent | TouchEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-project-picker]")) return;
      if (t?.closest("[data-project-picker-popover]")) return;
      setProjectPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [projectPickerOpen]);
  function openProjectPicker(anchorRect: DOMRect) {
    const POP_W = 192; // matches w-48
    const left = Math.min(
      anchorRect.left,
      window.innerWidth - POP_W - 8
    );
    setProjectPickerPos({ top: anchorRect.bottom + 4, left });
    setProjectPickerOpen(true);
  }
  async function moveToProject(projectId: string | null) {
    setProjectPickerOpen(false);
    // Optimistic source-side hide + destination insert via the move event.
    if (sourceListId && sourceProjectId !== projectId) {
      const toProjectName =
        projectId === null
          ? null
          : availableProjects.find((p) => p.id === projectId)?.name ?? null;
      window.dispatchEvent(
        new CustomEvent("personalos:todo-moved", {
          detail: {
            todoId: todo.id,
            fromListId: sourceListId,
            fromProjectId: sourceProjectId,
            toListId: sourceListId,
            toProjectId: projectId,
            toProjectName,
            todo: {
              ...todo,
              projectId,
              projectName: toProjectName,
              completedAt: todo.completedAt ?? null,
            },
          },
        }),
      );
    }
    fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    }).then((res) => {
      if (res.ok) startTransition(() => router.refresh());
    });
  }
  const menu: AnyMenuEntry[] = [
    {
      label: "Show details",
      icon: <ChevronRight className="size-3.5" />,
      onSelect: () => setDetailOpen(true),
    },
    {
      label: "Rename",
      icon: <Pencil className="size-3.5" />,
      onSelect: () => setEditing(true),
    },
    {
      label: "Move to…",
      icon: <ArrowRight className="size-3.5" />,
      submenu: availableLists
        .filter((l) => l.id !== sourceListId)
        .map((l) => ({
          label: l.name,
          onSelect: () => moveToList(l.id),
        })),
    },
    {
      label: "Project…",
      icon: <Folder className="size-3.5" />,
      submenu: [
        ...(todo.projectId
          ? [
              {
                label: "Remove from project",
                destructive: true,
                onSelect: () => moveToProject(null),
              },
            ]
          : []),
        ...availableProjects
          .filter((pr) => pr.id !== todo.projectId)
          .map((pr) => ({
            label: pr.name,
            onSelect: () => moveToProject(pr.id),
          })),
      ],
    },
    { separator: true },
    {
      label: "Delete",
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
      onSelect: deleteSelf,
    },
  ];

  const draggable = !editing && !!sourceListId && todo.id.startsWith("temp-") === false;
  const [dragging, setDragging] = useState(false);

  const [touchEnv, setTouchEnv] = useState(false);
  // Tracks the active pointer for long-press → drag arbitration.
  // axis: null (undecided) | "moved" (user panned/scrolled — cancel long-press)
  //        | "drag" (long-press fired, drag mode is live)
  const swipeRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    axis: null | "moved" | "drag";
    pointerId: number;
  }>({
    startX: 0,
    startY: 0,
    active: false,
    axis: null,
    pointerId: -1,
  });

  // Mobile long-press drag — 500ms hold without movement enters drag mode.
  // A floating ghost follows the finger, drop targets are any element with
  // [data-droptarget-list] up the DOM tree from elementFromPoint.
  const longPressTimerRef = useRef<number | null>(null);
  const swipeAreaRef = useRef<HTMLDivElement>(null);
  const dropTargetRef = useRef<HTMLElement | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const justDraggedRef = useRef(false);
  // Ghost element + pager track are written to directly during drag — no
  // setState in the pointermove hot path (would re-render the row at 60Hz+).
  const ghostRef = useRef<HTMLDivElement>(null);
  const pagerTrackRef = useRef<HTMLElement | null>(null);
  const [touchDragging, setTouchDragging] = useState(false);

  function positionGhost(x: number, y: number) {
    const el = ghostRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${x - 16}px, ${y - 22}px, 0) rotate(-1.5deg) scale(1.02)`;
  }

  function clearLongPress() {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }
  function clearTargetHighlight() {
    if (dropTargetRef.current) {
      dropTargetRef.current.removeAttribute("data-droptarget-active");
      dropTargetRef.current = null;
    }
  }
  function stopAutoScroll() {
    if (autoScrollRafRef.current != null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }
  function updateDropTarget(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const tgt = el?.closest("[data-droptarget-list]") as HTMLElement | null;
    if (tgt === dropTargetRef.current) return;
    clearTargetHighlight();
    if (!tgt) return;
    const tgtList = tgt.getAttribute("data-droptarget-list");
    const tgtProjRaw = tgt.getAttribute("data-droptarget-project") ?? "";
    const tgtProj = tgtProjRaw === "" ? null : tgtProjRaw;
    const samePlace =
      tgtList === sourceListId && tgtProj === (todo.projectId ?? null);
    if (samePlace) return;
    dropTargetRef.current = tgt;
    tgt.setAttribute("data-droptarget-active", "1");
  }
  function maybeAutoScroll(x: number, y: number) {
    const V_EDGE = 90;
    let dy = 0;
    if (y < V_EDGE) dy = -Math.ceil(((V_EDGE - y) / V_EDGE) * 14);
    else if (y > window.innerHeight - V_EDGE)
      dy = Math.ceil(((y - (window.innerHeight - V_EDGE)) / V_EDGE) * 14);

    // Pan the horizontal pager (if present) when the finger nears a side edge,
    // so a cross-page drag can reach a list in another pager page.
    const H_EDGE = 56;
    let dx = 0;
    const track = pagerTrackRef.current;
    if (track) {
      if (x < H_EDGE) dx = -Math.ceil(((H_EDGE - x) / H_EDGE) * 20);
      else if (x > window.innerWidth - H_EDGE)
        dx = Math.ceil(((x - (window.innerWidth - H_EDGE)) / H_EDGE) * 20);
    }

    stopAutoScroll();
    if (dy === 0 && dx === 0) return;
    const tick = () => {
      if (dy !== 0) window.scrollBy(0, dy);
      if (dx !== 0 && track) track.scrollBy({ left: dx });
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);
  }
  async function performTouchMove(
    targetListId: string,
    targetProjectId: string | null
  ) {
    window.dispatchEvent(
      new CustomEvent("personalos:todo-moved", {
        detail: {
          todoId: todo.id,
          fromListId: sourceListId,
          fromProjectId: sourceProjectId ?? null,
          toListId: targetListId,
          toProjectId: targetProjectId,
          toProjectName:
            targetProjectId === null
              ? null
              : availableProjects.find((p) => p.id === targetProjectId)
                  ?.name ?? todo.projectName ?? null,
          todo: { ...todo, completedAt: todo.completedAt ?? null },
        },
      })
    );
    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listId: targetListId,
          projectId: targetProjectId,
        }),
      });
      if (res.ok) router.refresh();
    } catch {}
  }

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearLongPress();
      clearTargetHighlight();
      stopAutoScroll();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setTouchEnv(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  function onSwipePointerDown(e: React.PointerEvent) {
    if (!touchEnv || editing || isSubtask) return;
    // Don't start arming a drag on form controls / buttons.
    const tgt = e.target as HTMLElement;
    if (tgt.closest("input, textarea, button")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    swipeRef.current = {
      startX,
      startY,
      active: true,
      axis: null,
      pointerId,
    };
    // Arm long-press → drag. Fires only if the finger hasn't moved more
    // than 5px in either direction within 500ms. Tighter threshold (vs 8px)
    // makes scroll intent win over drag whenever the user starts panning.
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      const s = swipeRef.current;
      if (!s.active || s.pointerId !== pointerId) return;
      if (s.axis === "moved") return;
      s.axis = "drag";
      try {
        swipeAreaRef.current?.setPointerCapture(pointerId);
      } catch {}
      try {
        (navigator as Navigator & { vibrate?: (n: number) => void }).vibrate?.(
          16
        );
      } catch {}
      pagerTrackRef.current = document.querySelector(
        "[data-pager-track]"
      ) as HTMLElement | null;
      setTouchDragging(true);
      // Position the ghost once the portal mounts (next frame).
      requestAnimationFrame(() => positionGhost(startX, startY));
      updateDropTarget(startX, startY);
    }, 500);
  }
  function onSwipePointerMove(e: React.PointerEvent) {
    if (!touchEnv) return;
    const s = swipeRef.current;
    if (!s.active || s.pointerId !== e.pointerId) return;
    if (s.axis === "drag") {
      e.preventDefault();
      positionGhost(e.clientX, e.clientY);
      updateDropTarget(e.clientX, e.clientY);
      maybeAutoScroll(e.clientX, e.clientY);
      return;
    }
    if (s.axis === null) {
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      // User started panning before long-press fired — let native scroll
      // take over and abandon the drag arm.
      s.axis = "moved";
      clearLongPress();
    }
  }
  function onSwipePointerUp(e: React.PointerEvent) {
    if (!touchEnv) return;
    const s = swipeRef.current;
    if (!s.active || s.pointerId !== e.pointerId) return;
    s.active = false;
    clearLongPress();
    if (s.axis === "drag") {
      e.preventDefault();
      stopAutoScroll();
      const tgt = dropTargetRef.current;
      clearTargetHighlight();
      pagerTrackRef.current = null;
      setTouchDragging(false);
      // The synthetic click that follows the pointerup of a drag would
      // otherwise hit the title and open edit mode. Block it briefly.
      justDraggedRef.current = true;
      window.setTimeout(() => {
        justDraggedRef.current = false;
      }, 350);
      if (tgt) {
        const tgtList = tgt.getAttribute("data-droptarget-list");
        const tgtProjRaw = tgt.getAttribute("data-droptarget-project") ?? "";
        const tgtProj = tgtProjRaw === "" ? null : tgtProjRaw;
        if (tgtList) void performTouchMove(tgtList, tgtProj);
      }
    }
  }

  function onDragStart(e: React.DragEvent<HTMLLIElement>) {
    if (!sourceListId) return;
    // Prevent the parent tile's drag-to-reorder handler from also firing,
    // which would set TILE_MIME data and shuffle the home tiles when the
    // user is just trying to move a single todo between lists.
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "application/x-personalos-todo",
      JSON.stringify({
        todoId: todo.id,
        sourceListId,
        sourceProjectId,
        todo: {
          id: todo.id,
          title: todo.title,
          notes: todo.notes ?? null,
          dueDate: todo.dueDate ?? null,
          completedAt: todo.completedAt ?? null,
          projectId: todo.projectId ?? null,
        },
      })
    );
    setDragging(true);
  }

  return (
    <li
      className={cn(
        "group relative overflow-hidden md:overflow-visible",
        // Mobile-only hairline between rows (iOS Reminders feel). Suppressed
        // on subtasks (they have their own indented ul border) and on the
        // last row (handled by parent ul's last:border-b-0 if used).
        !isSubtask && "border-b border-[var(--color-border)]/50 last:border-b-0 md:border-b-0",
        dragging && "opacity-40",
        // Completion choreography: collapse via grid-template-rows so
        // sibling rows reflow smoothly without JS height measurement.
        // minmax(0,1fr) keeps the implicit column from growing to the
        // min-content width of unbreakable content (long URLs).
        "grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-[260ms] ease-out-quart",
        leaving
          ? "grid-rows-[0fr] opacity-0 border-b-transparent"
          : "grid-rows-[1fr] opacity-100"
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      {...ctx.handlers}
    >
      <div
        className={cn(
          "min-h-0 min-w-0",
          leaving ? "overflow-hidden" : "overflow-hidden md:overflow-visible"
        )}
      >
      <div
        ref={swipeAreaRef}
        onPointerDown={onSwipePointerDown}
        onPointerMove={onSwipePointerMove}
        onPointerUp={onSwipePointerUp}
        onPointerCancel={onSwipePointerUp}
        style={
          touchEnv && !isSubtask
            ? {
                touchAction: touchDragging ? "none" : "pan-y",
                opacity: touchDragging ? 0.4 : undefined,
              }
            : undefined
        }
        className="relative z-10 bg-[var(--color-background)] md:bg-transparent"
      >
      <div
        className={cn(
          "flex items-start gap-3 px-1 py-3 md:py-2.5 md:hover:bg-[var(--color-accent)]/40 rounded-lg transition",
          // Optimistic (just-added) rows settle in instead of popping.
          todo.id.startsWith("temp-") && "animate-fade-in-up"
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.(todo.id);
          }}
          className={cn(
            "mt-0.5 grid size-6 md:size-[22px] shrink-0 place-items-center rounded-full border-2 md:border-[1.5px] transition-[color,background-color,border-color,transform] duration-200 active:scale-90 relative before:absolute before:-inset-2.5 before:content-[''] md:before:hidden",
            completed
              ? cn("text-white", p.fill, "border-transparent")
              : cn(
                  "border-[var(--color-muted-foreground)]/40 bg-transparent",
                  p.hoverBorder,
                  "hover:scale-105"
                )
          )}
          title={completed ? "Mark incomplete" : "Mark complete"}
        >
          <Check
            className={cn(
              "size-3.5 md:size-3",
              completed ? "animate-check-pop" : "scale-0"
            )}
            strokeWidth={3}
          />
        </button>
        <div
          className="flex-1 min-w-0 cursor-text select-none md:select-text"
          onClick={(e) => {
            e.stopPropagation();
            if (touchEnv && justDraggedRef.current) return;
            if (completed || editing) return;
            setEditing(true);
          }}
          onDoubleClick={(e) => {
            // Let users select words inside the input by double-clicking
            // it; only the wrapper-level double-click opens the modal.
            if (e.target instanceof HTMLInputElement) return;
            e.stopPropagation();
            setEditing(false);
            setDetailOpen(true);
          }}
        >
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              className={cn(
                "block w-full bg-transparent p-0 m-0 border-0 focus:outline-none focus:ring-0",
                "text-[17px] leading-[22px] tracking-[-0.022em]",
                "md:text-[15px] md:leading-snug md:tracking-normal",
              )}
            />
          ) : (
            <div
              className={cn(
                "text-[17px] leading-[22px] tracking-[-0.022em] md:text-[15px] md:leading-snug md:tracking-normal md:whitespace-normal break-words transition-[color,opacity] duration-300",
                completed && "line-through text-[var(--color-muted-foreground)]"
              )}
            >
              {linkifiedTitle}
            </div>
          )}
          {todo.notes ? (
            <div className="text-[15px] leading-[20px] text-[var(--color-muted-foreground)] truncate mt-0.5 md:text-xs md:leading-snug">
              {todo.notes}
            </div>
          ) : null}
          {showCreator && todo.creatorName ? (
            <div className="text-[13px] leading-[16px] text-[var(--color-muted-foreground)] mt-0.5 md:text-xs">
              added by {todo.creatorName}
            </div>
          ) : null}
          {todo.commentCount ? (
            <div
              className={cn(
                "mt-0.5 inline-flex items-center gap-1 text-[13px] leading-[16px] md:text-xs",
                todo.unreadCommentCount
                  ? "font-medium text-[var(--color-tint)]"
                  : "text-[var(--color-muted-foreground)]"
              )}
            >
              <MessageCircle className="size-3.5" />
              {todo.commentCount}
              {todo.unreadCommentCount ? (
                <span className="ml-0.5 rounded-full bg-[var(--color-tint)] px-1.5 py-px text-[10px] font-semibold leading-none text-white">
                  {todo.unreadCommentCount} new
                </span>
              ) : null}
            </div>
          ) : null}
          {/* Mobile-only date subtitle — Reminders-style "Mon, Jun 16" */}
          {due ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingDate(true);
              }}
              className={cn(
                "md:hidden block text-[13px] leading-[16px] mt-0.5 text-left tabular-nums",
                isOverdue
                  ? "text-rose-500 font-medium"
                  : "text-[var(--color-muted-foreground)]"
              )}
            >
              {formatCalendarDate(due, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </button>
          ) : null}
          {/* Mobile subtask row — only rendered when the task actually has
              subtasks (show count + collapse) OR while the row is in edit
              mode (offer "+ Subtask" contextually). Stays muted so it doesn't
              compete with the title visually. */}
          {!isSubtask && editing ? (
            <div className="md:hidden mt-1 flex items-center gap-3 text-[12px] text-[var(--color-muted-foreground)]/75">
              {editing ? (
                <button
                  // mousedown preventDefault stops the title input from
                  // blurring; without it, save() fires, setEditing(false)
                  // unmounts this button, and the click never registers.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingSub(true);
                    setSubsExpanded(true);
                  }}
                  className="inline-flex items-center gap-0.5 py-1 -my-1"
                >
                  <Plus className="size-3" />
                  <span>Subtask</span>
                </button>
              ) : null}
              {editing ? (
                <button
                  data-project-picker
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    openProjectPicker(
                      (e.currentTarget as HTMLElement).getBoundingClientRect()
                    );
                  }}
                  className="inline-flex items-center gap-0.5 py-1 -my-1 max-w-[8rem]"
                >
                  <Folder className="size-3" />
                  <span className="truncate">
                    {todo.projectName ?? "Project"}
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}
          {/* Desktop-only chip row: date pill, subtask count, add-subtask, project picker. */}
          <div className="mt-1 hidden md:flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            {(() => {
              // Age chip: decay made visible. Only past the two-week cliff.
              if (todo.completedAt || !todo.createdAt) return null;
              const days = Math.floor(
                (Date.now() - new Date(todo.createdAt).getTime()) / 864e5
              );
              if (days < 14) return null;
              return (
                <span
                  className="rounded px-1 py-0.5 tabular-nums bg-[var(--color-accent)]/60"
                  title={`Open for ${days} days`}
                >
                  {days >= 28 ? `${Math.floor(days / 7)}w` : `${days}d`}
                </span>
              );
            })()}
            {todo.snoozedUntil &&
            new Date(todo.snoozedUntil).getTime() <= Date.now() &&
            !todo.completedAt ? (
              <span
                className="rounded px-1 py-0.5 bg-[var(--color-accent)]/60"
                title="Snoozed item back on the list"
              >
                resurfaced
              </span>
            ) : null}
            {editingDate ? (
              <input
                ref={dateRef}
                type="date"
                defaultValue={toDateInputValue(due)}
                onBlur={(e) => saveDueDate(e.target.value || null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    saveDueDate((e.target as HTMLInputElement).value || null);
                  else if (e.key === "Escape") setEditingDate(false);
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-transparent border border-[var(--color-border)] rounded px-1 py-0.5 text-xs"
              />
            ) : due ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingDate(true);
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1 py-0.5 tabular-nums hover:bg-[var(--color-accent)]",
                  isOverdue && "text-rose-500 font-medium"
                )}
                title="Change due date"
              >
                <Calendar className="size-3" />
                {formatCalendarDate(due)}
                <X
                  className="size-3 opacity-50 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    saveDueDate(null);
                  }}
                />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingDate(true);
                }}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 opacity-50 md:opacity-0 md:group-hover:opacity-60 md:hover:opacity-100 hover:bg-[var(--color-accent)] transition"
                title="Add due date"
              >
                <Calendar className="size-3" />
                <span>Date</span>
              </button>
            )}
            {!isSubtask ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingSub(true);
                    setSubsExpanded(true);
                  }}
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 opacity-50 md:opacity-0 md:group-hover:opacity-60 md:hover:opacity-100 hover:bg-[var(--color-accent)] transition"
                  title="Add subtask"
                >
                  <Plus className="size-3" />
                  <span>Subtask</span>
                </button>
                <button
                  data-project-picker
                  onClick={(e) => {
                    e.stopPropagation();
                    openProjectPicker(
                      (e.currentTarget as HTMLElement).getBoundingClientRect()
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 opacity-0 md:group-hover:opacity-60 md:hover:opacity-100 hover:bg-[var(--color-accent)] transition"
                  title={todo.projectName ?? "Assign to project"}
                >
                  <Folder className="size-3" />
                  <span className="max-w-[8rem] truncate">
                    {todo.projectName ?? "Project"}
                  </span>
                </button>
              </>
            ) : null}
          </div>
        </div>
        {!isSubtask && hasSubs ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSubsExpanded((v) => !v);
            }}
            className="ml-auto self-center shrink-0 inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
            title={subsExpanded ? "Collapse subtasks" : "Expand subtasks"}
          >
            {subsExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <span className="tabular-nums">
              {subtasks.filter((s) => s.completedAt == null).length}/
              {subtasks.length}
            </span>
          </button>
        ) : null}
      </div>
      </div>

      {!isSubtask && (visibleSubtasks.length > 0 || addingSub) && subsExpanded ? (
        <ul className="ml-9 mt-px space-y-px border-l border-[var(--color-border)] pl-2">
          {visibleSubtasks.map((s) => (
            <TodoRow
              key={s.id}
              todo={s}
              listColor={listColor}
              isSubtask
              showCreator={showCreator}
              onToggle={() => onToggleSubtask?.(s.id)}
            />
          ))}
          {addingSub ? (
            <li className="flex items-start gap-2 px-1 py-1.5">
              <span className="mt-0.5 size-[18px] shrink-0 rounded-full border-2 border-[var(--color-border)]" />
              <input
                ref={subInputRef}
                value={subDraft}
                onChange={(e) => setSubDraft(e.target.value)}
                onBlur={submitSubtask}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitSubtask();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setAddingSub(false);
                    setSubDraft("");
                  }
                }}
                placeholder="New subtask"
                onClick={(e) => e.stopPropagation()}
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-[var(--color-muted-foreground)]/70"
              />
            </li>
          ) : null}
        </ul>
      ) : null}
      </div>
      <ContextMenuPopover pos={ctx.pos} items={menu} onClose={ctx.close} />
      {detailOpen ? (
        <TodoDetailModal
          open
          todoId={todo.id}
          initialTitle={displayTitle}
          initialNotes={todo.notes ?? null}
          initialSubtasks={subtasks.map((s) => ({
            id: s.id,
            title: s.title,
            completedAt: s.completedAt ?? null,
          }))}
          onClose={() => setDetailOpen(false)}
        />
      ) : null}
      {projectPickerOpen && projectPickerPos && typeof document !== "undefined"
        ? createPortal(
            <div
              data-project-picker-popover
              style={{
                position: "fixed",
                top: projectPickerPos.top,
                left: projectPickerPos.left,
                zIndex: 60,
              }}
              className="animate-scale-in origin-top-left w-48 max-h-64 overflow-y-auto rounded-xl border border-[var(--color-card-border)] bg-[var(--color-elevated)] shadow-popover"
              onClick={(e) => e.stopPropagation()}
            >
              {todo.projectId ? (
                <button
                  onClick={() => moveToProject(null)}
                  className="block w-full text-left px-3 py-2 text-[13px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                >
                  Remove from project
                </button>
              ) : null}
              {availableProjects
                .filter((pr) => pr.id !== todo.projectId)
                .map((pr) => (
                  <button
                    key={pr.id}
                    onClick={() => moveToProject(pr.id)}
                    className="block w-full text-left px-3 py-2 text-[13px] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
                  >
                    {pr.name}
                  </button>
                ))}
              {availableProjects.length === 0 ? (
                <div className="px-3 py-2 text-[13px] text-[var(--color-muted-foreground)]">
                  Loading…
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
      {touchDragging && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={ghostRef}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                transform: "translate3d(-9999px, -9999px, 0)",
                zIndex: 1000,
                pointerEvents: "none",
                maxWidth: "min(320px, 75vw)",
                willChange: "transform",
              }}
              className="rounded-xl bg-[var(--color-card)] shadow-2xl ring-2 ring-blue-500 px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn("shrink-0 size-4 rounded-full", p.fill)}
                />
                <span className="text-[15px] font-medium truncate">
                  {todo.title}
                </span>
              </div>
            </div>,
            document.body
          )
        : null}
    </li>
  );
}

// Memoize TodoRow so toggling one row (or any optimistic parent state change)
// doesn't reconcile every sibling row in the tile. The comparator ignores
// callback prop identity — parents pass top-of-scope functions (toggleComplete,
// saveDueDate, deleteTodo, etc.) whose identities are stable across renders,
// so we don't need a strict equality check on them.
function subtaskSignature(subs: TodoLike["subtasks"]): string {
  if (!subs || subs.length === 0) return "";
  let out = "";
  for (const s of subs) {
    out +=
      s.id +
      "|" +
      (s.completedAt
        ? typeof s.completedAt === "string"
          ? s.completedAt
          : s.completedAt.toISOString()
        : "") +
      "|" +
      s.title +
      ";";
  }
  return out;
}

function sameDate(a: TodoLike["dueDate"], b: TodoLike["dueDate"]): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const as = typeof a === "string" ? a : a.toISOString();
  const bs = typeof b === "string" ? b : b.toISOString();
  return as === bs;
}

function arePropsEqual(
  prev: React.ComponentProps<typeof TodoRowImpl>,
  next: React.ComponentProps<typeof TodoRowImpl>,
): boolean {
  if (prev.todo === next.todo) {
    // Same reference — definitely equal.
  } else {
    const a = prev.todo;
    const b = next.todo;
    if (a.id !== b.id) return false;
    if (a.title !== b.title) return false;
    if (a.notes !== b.notes) return false;
    if (a.projectId !== b.projectId) return false;
    if (a.projectName !== b.projectName) return false;
    if (a.creatorName !== b.creatorName) return false;
    if (a.commentCount !== b.commentCount) return false;
    if (a.unreadCommentCount !== b.unreadCommentCount) return false;
    if (
      (a.completedAt == null) !== (b.completedAt == null) ||
      (a.completedAt != null &&
        b.completedAt != null &&
        (typeof a.completedAt === "string"
          ? a.completedAt
          : a.completedAt.toISOString()) !==
          (typeof b.completedAt === "string"
            ? b.completedAt
            : b.completedAt.toISOString()))
    )
      return false;
    if (!sameDate(a.dueDate, b.dueDate)) return false;
    if (subtaskSignature(a.subtasks) !== subtaskSignature(b.subtasks))
      return false;
  }
  if (prev.listColor !== next.listColor) return false;
  if (prev.sourceListId !== next.sourceListId) return false;
  if (prev.sourceProjectId !== next.sourceProjectId) return false;
  if (prev.isSubtask !== next.isSubtask) return false;
  if (prev.showCreator !== next.showCreator) return false;
  if (prev.leaving !== next.leaving) return false;
  // showProjectBadge is a ReactNode; only compare presence (parents pass
  // either undefined or an empty fragment, never per-row dynamic content).
  if ((prev.showProjectBadge == null) !== (next.showProjectBadge == null))
    return false;
  return true;
}

export const TodoRow = memo(TodoRowImpl, arePropsEqual);
