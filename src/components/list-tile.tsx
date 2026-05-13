"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { palette } from "@/lib/lists";
import { cn } from "@/lib/utils";
import { TodoRow, type TodoLike } from "./todo-row";

export type ListInfo = {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
};

export function ListTile({
  list,
  todos,
  totalCount,
  projectId,
  projectLabel,
  reorderable,
  onReorderStart,
  onReorderOver,
  onReorderDrop,
  groupByProject,
}: {
  list: ListInfo;
  todos: TodoLike[];
  totalCount: number;
  projectId?: string;
  // Optional label shown under the list title (e.g. "Ferrari 456 GT") when
  // this tile is scoped to a project. Helps differentiate project-scoped
  // tiles from personal tiles on the Home view.
  projectLabel?: string;
  reorderable?: boolean;
  onReorderStart?: (id: string) => void;
  onReorderOver?: (id: string) => void;
  onReorderDrop?: (id: string) => void;
  // When true, group items by their project under collapsible sub-headers
  // (Personal first, then each project). Used on the Home unified tiles.
  groupByProject?: boolean;
}) {
  const router = useRouter();
  const p = palette(list.color);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Optimistic state. Adds live in pendingTodos; toggles live in completionOverrides.
  // Cross-list drops temporarily hide outgoing todos via hiddenIds (until the
  // server-rendered list catches up). All three auto-prune off the `todos` prop
  // so we never wait on router.refresh() to feel responsive.
  const [pendingTodos, setPendingTodos] = useState<TodoLike[]>([]);
  const [completionOverrides, setCompletionOverrides] = useState<
    Map<string, Date | null>
  >(new Map());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const collapseKey = `personalos:listcollapse:${list.id}:${projectId ?? "all"}`;

  useEffect(() => {
    try {
      const v = localStorage.getItem(collapseKey);
      if (v === "1") setCollapsed(true);
    } catch {}
  }, [collapseKey]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(collapseKey, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  // Per-group collapse state, persisted in localStorage. Used only when
  // groupByProject is enabled.
  const groupCollapseKey = `personalos:listgroupcollapse:${list.id}`;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!groupByProject) return;
    try {
      const raw = localStorage.getItem(groupCollapseKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setCollapsedGroups(new Set(arr));
      }
    } catch {}
  }, [groupByProject, groupCollapseKey]);
  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(groupCollapseKey, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  // Which project sub-group (if any) is currently being hovered as a drop
  // target. Used to highlight the section.
  const [overGroupKey, setOverGroupKey] = useState<string | null>(null);

  async function handleGroupDrop(
    e: React.DragEvent<HTMLDivElement>,
    groupProjectId: string | null
  ) {
    if (!e.dataTransfer.types.includes("application/x-personalos-todo")) return;
    const raw = e.dataTransfer.getData("application/x-personalos-todo");
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    setOverGroupKey(null);
    let payload: {
      todoId: string;
      sourceListId: string;
      sourceProjectId: string | null;
      todo: TodoLike;
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const samePlace =
      payload.sourceListId === list.id &&
      (payload.todo.projectId ?? null) === groupProjectId;
    if (samePlace) return;

    // Intra-tile move: same list, different project sub-section. Skip the
    // hiddenIds/pendingTodos optimistic dance — they're designed for
    // cross-tile transitions and would collide on the same todoId here
    // (pendingTodos duplicates, hiddenIds masks both copies). Just PATCH and
    // refresh; the server-rendered row will pop into the new section.
    const sameTile = payload.sourceListId === list.id;
    if (!sameTile) {
      setPendingTodos((prev) => [
        ...prev,
        { ...payload.todo, projectId: groupProjectId },
      ]);
      window.dispatchEvent(
        new CustomEvent("personalos:todo-moved", {
          detail: {
            todoId: payload.todoId,
            fromListId: payload.sourceListId,
            fromProjectId: payload.sourceProjectId,
            toListId: list.id,
            toProjectId: groupProjectId,
          },
        })
      );
    }
    try {
      const res = await fetch(`/api/todos/${payload.todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listId: list.id,
          projectId: groupProjectId,
        }),
      });
      if (res.ok) {
        startTransition(() => router.refresh());
      } else if (!sameTile) {
        setPendingTodos((prev) =>
          prev.filter((t) => t.id !== payload.todoId)
        );
      }
    } catch {
      if (!sameTile) {
        setPendingTodos((prev) =>
          prev.filter((t) => t.id !== payload.todoId)
        );
      }
    }
  }

  // Listen for cross-tile move events so the SOURCE tile immediately hides
  // the outgoing todo while the PATCH is in flight. A "tile" is identified
  // by the (listId, projectId) pair.
  const myProjectKey = projectId ?? null;
  useEffect(() => {
    function handler(ev: Event) {
      const e = ev as CustomEvent<{
        todoId: string;
        fromListId: string;
        fromProjectId: string | null;
        toListId: string;
        toProjectId: string | null;
      }>;
      if (!e.detail) return;
      const isSource =
        e.detail.fromListId === list.id && e.detail.fromProjectId === myProjectKey;
      const isTarget =
        e.detail.toListId === list.id && e.detail.toProjectId === myProjectKey;
      if (isSource && !isTarget) {
        setHiddenIds((prev) => {
          if (prev.has(e.detail.todoId)) return prev;
          const next = new Set(prev);
          next.add(e.detail.todoId);
          return next;
        });
      }
    }
    window.addEventListener("personalos:todo-moved", handler);
    return () => window.removeEventListener("personalos:todo-moved", handler);
  }, [list.id, myProjectKey]);

  // Drop pending entries once the server-rendered list contains them.
  useEffect(() => {
    setPendingTodos((prev) => {
      const serverIds = new Set(todos.map((t) => t.id));
      const next = prev.filter((t) => !serverIds.has(t.id));
      return next.length === prev.length ? prev : next;
    });
    // Drop hidden IDs once the server confirms they're no longer in this list.
    setHiddenIds((prev) => {
      if (prev.size === 0) return prev;
      const serverIds = new Set(todos.map((t) => t.id));
      const next = new Set<string>();
      for (const id of prev) if (serverIds.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
    // Drop completion overrides once the server's value matches (or the todo
    // dropped off the incomplete list, which already reflects the toggle).
    setCompletionOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      const serverById = new Map(todos.map((t) => [t.id, t]));
      for (const [id, override] of prev) {
        const server = serverById.get(id);
        if (!server) {
          // Not in incomplete list anymore — server has accepted the toggle.
          next.delete(id);
          continue;
        }
        const serverDone = server.completedAt != null;
        const overrideDone = override != null;
        if (serverDone === overrideDone) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [todos]);

  const visibleTodos = useMemo<TodoLike[]>(() => {
    const merged = [...todos, ...pendingTodos].filter((t) => !hiddenIds.has(t.id));
    if (completionOverrides.size === 0) return merged;
    return merged.map((t) =>
      completionOverrides.has(t.id)
        ? { ...t, completedAt: completionOverrides.get(t.id) ?? null }
        : t
    );
  }, [todos, pendingTodos, completionOverrides, hiddenIds]);

  async function createTodo(rawTitle: string) {
    const trimmed = rawTitle.trim();
    if (!trimmed) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPendingTodos((prev) => [
      ...prev,
      {
        id: tempId,
        title: trimmed,
        notes: null,
        dueDate: null,
        completedAt: null,
        projectId: projectId ?? null,
      },
    ]);

    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          listId: list.id,
          projectId: projectId ?? null,
        }),
      });
      if (res.ok) {
        const { todo } = (await res.json()) as { todo: TodoLike };
        setPendingTodos((prev) =>
          prev.map((t) => (t.id === tempId ? todo : t))
        );
      } else {
        setPendingTodos((prev) => prev.filter((t) => t.id !== tempId));
      }
    } catch {
      setPendingTodos((prev) => prev.filter((t) => t.id !== tempId));
    }
  }

  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle("");
    await createTodo(trimmed);
    startTransition(() => router.refresh());
  }

  // Strip markdown checkbox / bullet / numbered prefixes from a pasted line.
  function cleanLine(line: string): string {
    return line
      .replace(/^\s*[-*••]\s*\[[ xX]\]\s*/, "") // - [ ] / - [x]
      .replace(/^\s*[-*••]\s+/, "") // - / * / •
      .replace(/^\s*\d+[.)]\s+/, "") // 1. / 1)
      .trim();
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\n")) return; // single-line paste keeps default behavior
    e.preventDefault();
    const lines = text.split(/\r?\n/).map(cleanLine).filter((l) => l.length > 0);
    if (lines.length === 0) return;
    setTitle("");
    // Sequential to preserve order (server-side createdAt drives final sort).
    for (const line of lines) {
      await createTodo(line);
    }
    startTransition(() => router.refresh());
  }

  function toggleComplete(id: string) {
    const current = visibleTodos.find((t) => t.id === id);
    if (!current) return;
    const next = current.completedAt ? null : new Date();
    setCompletionOverrides((prev) => {
      const map = new Map(prev);
      map.set(id, next);
      return map;
    });
    fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggleComplete: true }),
    })
      .then((res) => {
        if (res.ok) startTransition(() => router.refresh());
        else
          setCompletionOverrides((prev) => {
            const map = new Map(prev);
            map.delete(id);
            return map;
          });
      })
      .catch(() => {
        setCompletionOverrides((prev) => {
          const map = new Map(prev);
          map.delete(id);
          return map;
        });
      });
  }

  async function toggleSubtask(subtaskId: string) {
    await fetch(`/api/todos/${subtaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggleComplete: true }),
    });
    startTransition(() => router.refresh());
  }

  async function addSubtask(parentId: string, title: string) {
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, parentId }),
    });
    startTransition(() => router.refresh());
  }

  async function deleteList() {
    if (!confirm(`Delete list "${list.name}"? Its todos will be deleted too.`)) return;
    const res = await fetch(`/api/lists/${list.id}`, { method: "DELETE" });
    if (res.ok) {
      setMenuOpen(false);
      startTransition(() => router.refresh());
    } else {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      alert(error ?? "Could not delete list");
    }
  }

  function startAdding() {
    setAdding(true);
  }

  function handleTileClick(e: React.MouseEvent<HTMLDivElement>) {
    if (adding) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, form, li")) return;
    startAdding();
  }

  const DRAG_MIME = "application/x-personalos-todo";
  const TILE_MIME = "application/x-personalos-list";

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes(TILE_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      onReorderOver?.(list.id);
      return;
    }
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isDragOver) setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only clear when the cursor actually leaves the tile (not when entering a child).
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragOver(false);
  }

  function handleTileDragStart(e: React.DragEvent<HTMLDivElement>) {
    if (!reorderable) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(TILE_MIME, list.id);
    onReorderStart?.(list.id);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    setIsDragOver(false);
    const tileId = e.dataTransfer.getData(TILE_MIME);
    if (tileId) {
      e.preventDefault();
      onReorderDrop?.(list.id);
      return;
    }
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    let payload: {
      todoId: string;
      sourceListId: string;
      sourceProjectId: string | null;
      todo: TodoLike;
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    // When the target tile isn't project-scoped (e.g. Home columns rendered
    // with groupByProject and no explicit projectId), preserve the source
    // todo's project rather than nulling it out.
    const targetProjectId =
      myProjectKey ?? payload.todo.projectId ?? null;

    // Same tile (same list AND same effective project) → no-op.
    if (
      payload.sourceListId === list.id &&
      (payload.todo.projectId ?? null) === targetProjectId
    ) {
      return;
    }

    // Optimistic: add to this tile immediately and tell the source tile to hide.
    setPendingTodos((prev) => [
      ...prev,
      { ...payload.todo, projectId: targetProjectId },
    ]);
    window.dispatchEvent(
      new CustomEvent("personalos:todo-moved", {
        detail: {
          todoId: payload.todoId,
          fromListId: payload.sourceListId,
          fromProjectId: payload.sourceProjectId,
          toListId: list.id,
          toProjectId: targetProjectId,
        },
      })
    );

    try {
      const res = await fetch(`/api/todos/${payload.todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: list.id, projectId: targetProjectId }),
      });
      if (res.ok) {
        startTransition(() => router.refresh());
      } else {
        setPendingTodos((prev) => prev.filter((t) => t.id !== payload.todoId));
        window.dispatchEvent(
          new CustomEvent("personalos:todo-moved", {
            detail: {
              todoId: payload.todoId,
              fromListId: list.id,
              fromProjectId: targetProjectId,
              toListId: payload.sourceListId,
              toProjectId: payload.sourceProjectId,
            },
          })
        );
      }
    } catch {
      setPendingTodos((prev) => prev.filter((t) => t.id !== payload.todoId));
    }
  }

  return (
    <div
      draggable={reorderable}
      onDragStart={handleTileDragStart}
      onClick={handleTileClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "group/tile flex flex-col transition relative rounded-2xl bg-[var(--color-card)] px-4 pt-4 pb-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.04)] md:bg-[var(--color-card)]/60 md:backdrop-blur md:shadow-none md:ring-2 md:ring-transparent",
        !collapsed && "md:min-h-[420px]",
        !adding && "cursor-pointer md:hover:bg-[var(--color-card)]",
        isDragOver &&
          cn("md:bg-[var(--color-card)]", p.ring.replace("/50", "/70"))
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5 md:mb-3">
        <div className="flex items-start gap-1 min-w-0">
          {reorderable ? (
            <span
              className="mt-1 text-[var(--color-muted-foreground)] hidden md:inline-block opacity-0 group-hover/tile:opacity-50 hover:opacity-100 transition cursor-grab active:cursor-grabbing"
              title="Drag to reorder"
            >
              <GripVertical className="size-4" />
            </span>
          ) : null}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed();
            }}
            className="mt-1 rounded p-0.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            {/* Mobile: Reminders-style — small colored dot + neutral title + muted count. */}
            <div className="flex items-center gap-2 min-w-0 md:hidden">
              <span
                aria-hidden
                className={cn("shrink-0 size-[18px] rounded-full", p.fill)}
              />
              <h2 className="truncate text-[17px] font-semibold tracking-tight text-[var(--color-foreground)]">
                {list.name}
              </h2>
              <span className="shrink-0 text-sm tabular-nums text-[var(--color-muted-foreground)]">
                {totalCount + (visibleTodos.length - todos.length)}
              </span>
            </div>
            {/* Desktop: bold colored title + colored count, unchanged. */}
            <div className="hidden md:flex md:items-baseline md:gap-3 min-w-0">
              <h2
                className={cn(
                  "text-2xl font-bold tracking-tight truncate",
                  p.text
                )}
              >
                {list.name}
              </h2>
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums shrink-0",
                  p.text
                )}
              >
                {totalCount + (visibleTodos.length - todos.length)}
              </span>
            </div>
            {projectLabel ? (
              <div className="text-xs text-[var(--color-muted-foreground)] truncate -mt-0.5">
                {projectLabel}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              startAdding();
            }}
            className={cn(
              "rounded-full p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition",
              p.text
            )}
            title={`Add to ${list.name}`}
          >
            <Plus className="size-4" />
          </button>
          {!list.isDefault ? (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="rounded-full p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
                title="List options"
              >
                <MoreHorizontal className="size-4" />
              </button>
              {menuOpen ? (
                <div
                  className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={deleteList}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-500 hover:bg-[var(--color-accent)]"
                  >
                    <Trash2 className="size-3.5" /> Delete list
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {collapsed ? null : (
      <div className="flex-1 flex flex-col">
        {groupByProject ? (
          (() => {
            const buckets = new Map<string, TodoLike[]>();
            for (const t of visibleTodos) {
              const key = t.projectName ?? "__inbox__";
              const arr = buckets.get(key) ?? [];
              arr.push(t);
              buckets.set(key, arr);
            }
            const ordered: Array<{ key: string; label: string; todos: TodoLike[] }> = [];
            if (buckets.has("__inbox__")) {
              ordered.push({
                key: "__inbox__",
                label: "Inbox",
                todos: buckets.get("__inbox__")!,
              });
            }
            for (const [key, ts] of [...buckets.entries()].sort(([a], [b]) =>
              a.localeCompare(b)
            )) {
              if (key === "__inbox__") continue;
              ordered.push({ key, label: key, todos: ts });
            }
            return (
              <div className="-mx-1">
                {ordered.map((g) => {
                  const open = !collapsedGroups.has(g.key);
                  const groupProjectId = g.todos[0]?.projectId ?? null;
                  const isOver = overGroupKey === g.key;
                  return (
                    <div
                      key={g.key}
                      onDragOver={(e) => {
                        if (
                          !e.dataTransfer.types.includes(
                            "application/x-personalos-todo"
                          )
                        )
                          return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        if (overGroupKey !== g.key) setOverGroupKey(g.key);
                      }}
                      onDragLeave={(e) => {
                        if (
                          e.currentTarget.contains(
                            e.relatedTarget as Node | null
                          )
                        )
                          return;
                        if (overGroupKey === g.key) setOverGroupKey(null);
                      }}
                      onDrop={(e) => handleGroupDrop(e, groupProjectId)}
                      className={cn(
                        "mb-1 rounded transition",
                        isOver &&
                          "ring-2 ring-[var(--color-ring)] bg-[var(--color-accent)]/40"
                      )}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroup(g.key);
                        }}
                        className="w-full flex items-center gap-1.5 px-1 pt-3 pb-1 text-[13px] md:text-[11px] font-medium md:font-semibold uppercase tracking-[0.06em] md:tracking-wider text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40 rounded md:pt-1 md:pb-1"
                      >
                        {open ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                        <span className="truncate">{g.label}</span>
                        <span className="tabular-nums opacity-70">
                          {g.todos.length}
                        </span>
                      </button>
                      {open ? (
                        <ul className="space-y-px">
                          {g.todos.map((todo) => (
                            <TodoRow
                              key={todo.id}
                              todo={todo}
                              listColor={list.color}
                              sourceListId={list.id}
                              sourceProjectId={myProjectKey}
                              showProjectBadge={<></>}
                              onToggle={() => toggleComplete(todo.id)}
                              onToggleSubtask={toggleSubtask}
                              onAddSubtask={addSubtask}
                            />
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
                {totalCount > todos.length ? (
                  <div className="px-2 py-2 text-xs text-[var(--color-muted-foreground)]">
                    +{totalCount - todos.length} more…
                  </div>
                ) : null}
              </div>
            );
          })()
        ) : (
          <ul className="space-y-px -mx-1">
            {visibleTodos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                listColor={list.color}
                sourceListId={list.id}
                sourceProjectId={myProjectKey}
                onToggle={() => toggleComplete(todo.id)}
                onToggleSubtask={toggleSubtask}
                onAddSubtask={addSubtask}
              />
            ))}
            {totalCount > todos.length ? (
              <li
                data-row
                className="px-2 py-2 text-xs text-[var(--color-muted-foreground)]"
              >
                +{totalCount - todos.length} more…
              </li>
            ) : null}
          </ul>
        )}

        {adding ? (
          <form onSubmit={addTodo} className="px-1 pt-2 pb-1">
            <div className="flex items-start gap-3 py-1">
              <span
                className={cn(
                  "mt-0.5 size-6 md:size-[22px] shrink-0 rounded-full border-2 border-[var(--color-border)]"
                )}
              />
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onPaste={handlePaste}
                onBlur={() => {
                  if (!title.trim()) setAdding(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setAdding(false);
                    setTitle("");
                  }
                }}
                placeholder="New Reminder (paste a list to add many)"
                className="flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-[var(--color-muted-foreground)]/70"
              />
            </div>
          </form>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              startAdding();
            }}
            className={cn(
              "flex items-center gap-2.5 px-0 py-3 text-[17px] md:text-sm font-normal md:font-medium md:mt-1 md:px-2 md:py-2 md:gap-2 transition hover:opacity-80 text-left",
              p.text
            )}
          >
            <span
              className={cn(
                "grid size-[22px] place-items-center rounded-full border-2 border-current md:border-0",
                p.softBg
              )}
            >
              <Plus className="size-3.5" strokeWidth={2.5} />
            </span>
            <span>New Reminder</span>
          </button>
        )}

        <div className="flex-1 min-h-[20px]" aria-hidden />
      </div>
      )}
    </div>
  );
}
