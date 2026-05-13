"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { palette } from "@/lib/lists";
import { cn } from "@/lib/utils";
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
  subtasks?: TodoLike[];
};

export function TodoRow({
  todo,
  onToggle,
  onToggleSubtask,
  onAddSubtask,
  listColor = "zinc",
  sourceListId,
  sourceProjectId = null,
  showProjectBadge,
  isSubtask,
}: {
  todo: TodoLike;
  onToggle?: () => void;
  onToggleSubtask?: (subtaskId: string) => void;
  onAddSubtask?: (parentId: string, title: string) => Promise<void> | void;
  listColor?: string;
  sourceListId?: string;
  sourceProjectId?: string | null;
  showProjectBadge?: React.ReactNode;
  isSubtask?: boolean;
}) {
  const router = useRouter();
  const completed = todo.completedAt != null;
  const due = todo.dueDate ? new Date(todo.dueDate) : null;
  const isOverdue = due ? due.getTime() < Date.now() && !completed : false;
  const p = palette(listColor);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.title);
  const [editingDate, setEditingDate] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [subDraft, setSubDraft] = useState("");
  const [subsExpanded, setSubsExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const subInputRef = useRef<HTMLInputElement>(null);
  const subtasks = todo.subtasks ?? [];
  const hasSubs = subtasks.length > 0;

  // Re-sync draft when the underlying todo title changes from server.
  useEffect(() => {
    if (!editing) setDraft(todo.title);
  }, [todo.title, editing]);

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
    if (!next || next === todo.title) {
      setEditing(false);
      setDraft(todo.title);
      return;
    }
    setEditing(false);
    await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    router.refresh();
  }

  function cancelEdit() {
    setDraft(todo.title);
    setEditing(false);
  }

  async function saveDueDate(value: string | null) {
    setEditingDate(false);
    await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: value }),
    });
    router.refresh();
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

  async function submitSubtask() {
    const t = subDraft.trim();
    if (!t) {
      setAddingSub(false);
      return;
    }
    setSubDraft("");
    setAddingSub(false);
    await onAddSubtask?.(todo.id, t);
  }

  // Right-click / long-press context menu.
  const ctx = useContextMenu();
  const [availableLists, setAvailableLists] = useState<
    { id: string; name: string; color: string }[]
  >([]);
  useEffect(() => {
    if (!ctx.isOpen || availableLists.length > 0) return;
    fetch("/api/lists")
      .then((r) => r.json())
      .then((d) => setAvailableLists(d.lists ?? []))
      .catch(() => {});
  }, [ctx.isOpen, availableLists.length]);

  async function deleteSelf() {
    await fetch(`/api/todos/${todo.id}`, { method: "DELETE" });
    router.refresh();
  }
  async function moveToList(listId: string) {
    await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listId }),
    });
    router.refresh();
  }
  const menu: AnyMenuEntry[] = [
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

  // Mobile swipe: right → complete, left → reveal Schedule + Delete chips.
  const [swipeX, setSwipeX] = useState(0);
  const [touchEnv, setTouchEnv] = useState(false);
  const swipeRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    axis: null | "x" | "y";
    startTranslate: number;
    pointerId: number;
  }>({
    startX: 0,
    startY: 0,
    active: false,
    axis: null,
    startTranslate: 0,
    pointerId: -1,
  });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setTouchEnv(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const swipeOpen = swipeX < -40;

  function onSwipePointerDown(e: React.PointerEvent) {
    if (!touchEnv || editing || isSubtask) return;
    // Don't begin a swipe on form controls / buttons.
    const tgt = e.target as HTMLElement;
    if (tgt.closest("input, textarea, button")) return;
    swipeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      active: true,
      axis: null,
      startTranslate: swipeX,
      pointerId: e.pointerId,
    };
  }
  function onSwipePointerMove(e: React.PointerEvent) {
    if (!touchEnv) return;
    const s = swipeRef.current;
    if (!s.active || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
    }
    if (s.axis !== "x") return;
    e.preventDefault();
    let next = s.startTranslate + dx;
    if (next > 0) next = next * 0.4;
    if (next < -160) next = -160 + (next + 160) * 0.4;
    setSwipeX(next);
  }
  function onSwipePointerUp(e: React.PointerEvent) {
    if (!touchEnv) return;
    const s = swipeRef.current;
    if (!s.active || s.pointerId !== e.pointerId) return;
    s.active = false;
    if (s.axis !== "x") {
      setSwipeX(s.startTranslate);
      return;
    }
    if (swipeX > 60) {
      setSwipeX(0);
      onToggle?.();
    } else if (swipeX < -60) {
      setSwipeX(-128);
    } else {
      setSwipeX(0);
    }
  }
  function closeSwipe() {
    setSwipeX(0);
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
        dragging && "opacity-40"
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      {...ctx.handlers}
    >
      {touchEnv && !isSubtask ? (
        <div
          className={cn(
            "absolute inset-y-0 right-0 z-0 flex items-center gap-1 pr-1 transition-opacity",
            swipeOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          aria-hidden={!swipeOpen}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeSwipe();
              setEditingDate(true);
            }}
            className="inline-flex h-full items-center gap-1 rounded-md bg-blue-500 px-3 text-xs font-semibold text-white"
          >
            <Calendar className="size-3.5" />
            Schedule
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeSwipe();
              void deleteSelf();
            }}
            className="inline-flex h-full items-center gap-1 rounded-md bg-rose-500 px-3 text-xs font-semibold text-white"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </div>
      ) : null}
      <div
        onPointerDown={onSwipePointerDown}
        onPointerMove={onSwipePointerMove}
        onPointerUp={onSwipePointerUp}
        onPointerCancel={onSwipePointerUp}
        onClick={swipeOpen ? closeSwipe : undefined}
        style={
          touchEnv && !isSubtask
            ? {
                transform: `translateX(${swipeX}px)`,
                transition: swipeRef.current.active
                  ? "none"
                  : "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                touchAction: "pan-y",
              }
            : undefined
        }
        className="relative z-10 bg-[var(--color-background)]"
      >
      <div className="flex items-start gap-3 px-1 py-3 md:py-2.5 hover:bg-[var(--color-accent)]/40 rounded-lg transition">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          className={cn(
            "mt-0.5 ml-1 grid size-6 md:size-[22px] shrink-0 place-items-center rounded-full border-2 transition-colors duration-200 relative before:absolute before:-inset-2.5 before:content-[''] md:before:hidden",
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
              "size-3.5 md:size-3 transition-transform duration-200",
              completed ? "scale-100" : "scale-0"
            )}
            strokeWidth={3.5}
          />
        </button>
        <div
          className="flex-1 min-w-0 cursor-text select-none md:select-text"
          onClick={(e) => {
            // On touch, single-tap enters edit mode (was the previous behavior).
            // On desktop, that felt twitchy — require a double-click instead.
            if (touchEnv) {
              e.stopPropagation();
              if (!completed) setEditing(true);
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!completed) setEditing(true);
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
              className="w-full bg-transparent text-[15px] leading-snug focus:outline-none"
            />
          ) : (
            <div
              className={cn(
                "text-[15px] leading-snug",
                completed && "line-through text-[var(--color-muted-foreground)]"
              )}
            >
              {todo.title}
            </div>
          )}
          {todo.notes ? (
            <div className="text-xs text-[var(--color-muted-foreground)] truncate mt-0.5">
              {todo.notes}
            </div>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            {showProjectBadge ??
              (todo.projectName ? (
                <span className="inline-flex items-center rounded bg-[var(--color-accent)]/60 px-1.5 py-0.5 text-[10px] font-medium">
                  {todo.projectName}
                </span>
              ) : null)}
            {editingDate ? (
              <input
                ref={dateRef}
                type="date"
                defaultValue={due ? due.toISOString().slice(0, 10) : ""}
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
                  "inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--color-accent)]",
                  isOverdue && "text-rose-500 font-medium"
                )}
                title="Change due date"
              >
                <Calendar className="size-3" />
                {due.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
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
                {hasSubs ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSubsExpanded((v) => !v);
                    }}
                    className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-[var(--color-accent)]"
                    title={subsExpanded ? "Collapse subtasks" : "Expand subtasks"}
                  >
                    {subsExpanded ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    <span>
                      {subtasks.filter((s) => s.completedAt == null).length}/
                      {subtasks.length}
                    </span>
                  </button>
                ) : null}
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
              </>
            ) : null}
          </div>
        </div>
      </div>
      </div>

      {!isSubtask && (hasSubs || addingSub) && subsExpanded ? (
        <ul className="ml-9 mt-px space-y-px border-l border-[var(--color-border)] pl-2">
          {subtasks.map((s) => (
            <TodoRow
              key={s.id}
              todo={s}
              listColor={listColor}
              isSubtask
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
      <ContextMenuPopover pos={ctx.pos} items={menu} onClose={ctx.close} />
    </li>
  );
}
