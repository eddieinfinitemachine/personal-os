"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { palette } from "@/lib/lists";
import { cn } from "@/lib/utils";
import { TodoRow, type TodoLike } from "./todo-row";

type ListInfo = { id: string; name: string; color: string };

export type ProjectCardData = {
  project: { id: string; name: string; kind: string };
  byList: Array<{ list: ListInfo; todos: TodoLike[]; totalCount: number }>;
  totalCount: number;
};

const DRAG_MIME = "application/x-personalos-todo";

export function ProjectCard({ data }: { data: ProjectCardData }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, Date | null>>(new Map());
  const [dueDateOverrides, setDueDateOverrides] = useState<
    Map<string, Date | null>
  >(new Map());
  // Optimistic adds when dropping a todo from another column/tile.
  const [pendingByList, setPendingByList] = useState<Map<string, TodoLike[]>>(
    new Map()
  );
  // Newly-added subtasks, keyed by parent todo id. Same pattern as ListTile.
  const [pendingSubtasks, setPendingSubtasks] = useState<
    Map<string, TodoLike[]>
  >(new Map());
  // Optimistic completedAt overrides for individual subtasks.
  const [subtaskOverrides, setSubtaskOverrides] = useState<
    Map<string, Date | null>
  >(new Map());
  const [dragOverList, setDragOverList] = useState<string | null>(null);

  // Listen for cross-tile move events so any column that owns the source
  // todo immediately hides it.
  useEffect(() => {
    function handler(ev: Event) {
      const e = ev as CustomEvent<{
        todoId: string;
        fromListId: string;
        fromProjectId: string | null;
        toListId: string;
        toProjectId: string | null;
        toProjectName?: string | null;
        todo?: TodoLike;
      }>;
      if (!e.detail) return;
      const isSource =
        e.detail.fromProjectId === data.project.id &&
        data.byList.some((g) => g.list.id === e.detail.fromListId);
      const isTarget =
        e.detail.toProjectId === data.project.id &&
        data.byList.some((g) => g.list.id === e.detail.toListId);
      if (isSource && !isTarget) {
        setHidden((prev) => {
          if (prev.has(e.detail.todoId)) return prev;
          const next = new Set(prev);
          next.add(e.detail.todoId);
          return next;
        });
      } else if (!isSource && isTarget && e.detail.todo) {
        // The row is moving INTO this card. Insert into the target list
        // optimistically so it appears before router.refresh lands.
        setPendingByList((prev) => {
          const next = new Map(prev);
          const arr = next.get(e.detail.toListId) ?? [];
          if (arr.some((t) => t.id === e.detail.todoId)) return prev;
          next.set(e.detail.toListId, [
            ...arr,
            {
              ...(e.detail.todo as TodoLike),
              projectId: data.project.id,
            },
          ]);
          return next;
        });
        // Clear any stale hide for this id (in case of fast double-moves).
        setHidden((prev) => {
          if (!prev.has(e.detail.todoId)) return prev;
          const next = new Set(prev);
          next.delete(e.detail.todoId);
          return next;
        });
      }
    }
    window.addEventListener("personalos:todo-moved", handler);
    return () => window.removeEventListener("personalos:todo-moved", handler);
  }, [data.project.id, data.byList]);

  const collapseKey = `personalos:projectcard:${data.project.id}`;
  useEffect(() => {
    try {
      const v = localStorage.getItem(collapseKey);
      if (v === "1") setCollapsed(true);
    } catch {}
  }, [collapseKey]);

  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(collapseKey, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  // Drop hidden / override / pending entries when the server-rendered data
  // catches up.
  const allServerIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of data.byList) for (const t of g.todos) s.add(t.id);
    return s;
  }, [data]);
  const serverIdsByList = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const g of data.byList) m.set(g.list.id, new Set(g.todos.map((t) => t.id)));
    return m;
  }, [data]);
  useEffect(() => {
    setHidden((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) if (allServerIds.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
    setOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const [id] of prev) if (!allServerIds.has(id)) next.delete(id);
      return next.size === prev.size ? prev : next;
    });
    setDueDateOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const [id] of prev) if (!allServerIds.has(id)) next.delete(id);
      return next.size === prev.size ? prev : next;
    });
    // Drop optimistic subtasks once the server confirms them.
    setPendingSubtasks((prev) => {
      if (prev.size === 0) return prev;
      const subsByParent = new Map<string, Set<string>>();
      for (const g of data.byList) {
        for (const t of g.todos) {
          if (t.subtasks?.length) {
            subsByParent.set(t.id, new Set(t.subtasks.map((s) => s.id)));
          }
        }
      }
      const next = new Map(prev);
      for (const [parentId, optimistic] of prev) {
        const confirmed = subsByParent.get(parentId) ?? new Set<string>();
        const remaining = optimistic.filter((s) => !confirmed.has(s.id));
        if (remaining.length === 0) next.delete(parentId);
        else if (remaining.length !== optimistic.length)
          next.set(parentId, remaining);
      }
      return next.size === prev.size ? prev : next;
    });
    // Drop subtask toggle overrides once the server reflects them.
    setSubtaskOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const g of data.byList) {
        for (const t of g.todos) {
          for (const s of t.subtasks ?? []) {
            if (!next.has(s.id)) continue;
            const overrideVal = next.get(s.id) ?? null;
            const serverVal = s.completedAt
              ? new Date(s.completedAt as string | Date)
              : null;
            // Both null OR both non-null = considered matched (we don't
            // compare exact ms, just truthy state which is what the UI cares
            // about for a check mark).
            if (
              (overrideVal === null) === (serverVal === null) &&
              (overrideVal === null || serverVal !== null)
            ) {
              next.delete(s.id);
            }
          }
        }
      }
      return next.size === prev.size ? prev : next;
    });
    setPendingByList((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map<string, TodoLike[]>();
      for (const [listId, todos] of prev) {
        const ids = serverIdsByList.get(listId) ?? new Set();
        const remaining = todos.filter((t) => !ids.has(t.id));
        if (remaining.length > 0) next.set(listId, remaining);
      }
      return next.size === prev.size && next === prev ? prev : next;
    });
  }, [allServerIds, serverIdsByList]);

  function toggleComplete(id: string) {
    const isDone = overrides.has(id) ? overrides.get(id) != null : false;
    const completing = !isDone;
    const next = completing ? new Date() : null;
    setOverrides((prev) => {
      const m = new Map(prev);
      m.set(id, next);
      return m;
    });
    // Project lists only show incomplete todos, so a completed one should leave
    // immediately. Hide it optimistically; the refresh prune drops the hidden
    // id once the server stops returning it.
    if (completing) {
      setHidden((prev) => {
        if (prev.has(id)) return prev;
        const n = new Set(prev);
        n.add(id);
        return n;
      });
    }
    const rollback = () => {
      setOverrides((prev) => {
        const m = new Map(prev);
        m.delete(id);
        return m;
      });
      if (completing) {
        setHidden((prev) => {
          if (!prev.has(id)) return prev;
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    };
    fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggleComplete: true }),
    })
      .then((res) => {
        if (res.ok) startTransition(() => router.refresh());
        else rollback();
      })
      .catch(rollback);
  }

  function toggleSubtask(subtaskId: string) {
    let currentCompletedAt: Date | string | null = null;
    if (subtaskOverrides.has(subtaskId)) {
      currentCompletedAt = subtaskOverrides.get(subtaskId) ?? null;
    } else {
      outer: for (const g of data.byList) {
        for (const t of g.todos) {
          for (const s of t.subtasks ?? []) {
            if (s.id === subtaskId) {
              currentCompletedAt = s.completedAt ?? null;
              break outer;
            }
          }
        }
      }
    }
    const next: Date | null = currentCompletedAt ? null : new Date();
    setSubtaskOverrides((prev) => {
      const m = new Map(prev);
      m.set(subtaskId, next);
      return m;
    });
    fetch(`/api/todos/${subtaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggleComplete: true }),
    })
      .then((res) => {
        if (res.ok) startTransition(() => router.refresh());
        else
          setSubtaskOverrides((prev) => {
            const m = new Map(prev);
            m.delete(subtaskId);
            return m;
          });
      })
      .catch(() =>
        setSubtaskOverrides((prev) => {
          const m = new Map(prev);
          m.delete(subtaskId);
          return m;
        }),
      );
  }
  function saveDueDate(id: string, value: string | null) {
    const nextDate: Date | null = value ? new Date(value) : null;
    setDueDateOverrides((prev) => {
      const m = new Map(prev);
      m.set(id, nextDate);
      return m;
    });
    fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: value }),
    })
      .then((res) => {
        if (res.ok) startTransition(() => router.refresh());
        else
          setDueDateOverrides((prev) => {
            if (!prev.has(id)) return prev;
            const m = new Map(prev);
            m.delete(id);
            return m;
          });
      })
      .catch(() =>
        setDueDateOverrides((prev) => {
          if (!prev.has(id)) return prev;
          const m = new Map(prev);
          m.delete(id);
          return m;
        }),
      );
  }

  function deleteTodo(id: string) {
    setHidden((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    fetch(`/api/todos/${id}`, { method: "DELETE" })
      .then((res) => {
        if (res.ok) startTransition(() => router.refresh());
        else
          setHidden((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
      })
      .catch(() =>
        setHidden((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      );
  }

  async function addSubtask(parentId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: TodoLike = {
      id: tempId,
      title: trimmed,
      notes: null,
      dueDate: null,
      completedAt: null,
      projectId: data.project.id,
    };
    setPendingSubtasks((prev) => {
      const next = new Map(prev);
      next.set(parentId, [...(next.get(parentId) ?? []), optimistic]);
      return next;
    });
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed, parentId }),
      });
      if (res.ok) {
        const { todo: real } = (await res.json()) as { todo: TodoLike };
        setPendingSubtasks((prev) => {
          const next = new Map(prev);
          const cur = next.get(parentId);
          if (cur) {
            next.set(
              parentId,
              cur.map((s) => (s.id === tempId ? real : s)),
            );
          }
          return next;
        });
        startTransition(() => router.refresh());
      } else {
        rollbackSubtask(parentId, tempId);
      }
    } catch {
      rollbackSubtask(parentId, tempId);
    }
  }

  function rollbackSubtask(parentId: string, tempId: string) {
    setPendingSubtasks((prev) => {
      const next = new Map(prev);
      const cur = next.get(parentId);
      if (!cur) return prev;
      const filtered = cur.filter((s) => s.id !== tempId);
      if (filtered.length === 0) next.delete(parentId);
      else next.set(parentId, filtered);
      return next;
    });
  }

  function handleColumnDragOver(
    e: React.DragEvent<HTMLDivElement>,
    listId: string
  ) {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dragOverList !== listId) setDragOverList(listId);
  }

  function handleColumnDragLeave(
    e: React.DragEvent<HTMLDivElement>,
    listId: string
  ) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (dragOverList === listId) setDragOverList(null);
  }

  async function handleColumnDrop(
    e: React.DragEvent<HTMLDivElement>,
    listId: string
  ) {
    setDragOverList(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
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
    // No-op if dropped back into the same column of the same project.
    if (
      payload.sourceListId === listId &&
      payload.sourceProjectId === data.project.id
    )
      return;

    // Optimistic insert into target column + dispatch event so source clears.
    setPendingByList((prev) => {
      const next = new Map(prev);
      const arr = next.get(listId) ?? [];
      next.set(listId, [...arr, { ...payload.todo, projectId: data.project.id }]);
      return next;
    });
    window.dispatchEvent(
      new CustomEvent("personalos:todo-moved", {
        detail: {
          todoId: payload.todoId,
          fromListId: payload.sourceListId,
          fromProjectId: payload.sourceProjectId,
          toListId: listId,
          toProjectId: data.project.id,
        },
      })
    );

    try {
      const res = await fetch(`/api/todos/${payload.todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId, projectId: data.project.id }),
      });
      if (res.ok) {
        startTransition(() => router.refresh());
      } else {
        // Roll back optimistic insert.
        setPendingByList((prev) => {
          const next = new Map(prev);
          const arr = next.get(listId) ?? [];
          next.set(
            listId,
            arr.filter((t) => t.id !== payload.todoId)
          );
          return next;
        });
      }
    } catch {
      setPendingByList((prev) => {
        const next = new Map(prev);
        const arr = next.get(listId) ?? [];
        next.set(
          listId,
          arr.filter((t) => t.id !== payload.todoId)
        );
        return next;
      });
    }
  }

  return (
    <div className="rounded-2xl bg-[var(--color-card)] border border-[var(--color-card-border)] shadow-card px-4 pt-3 pb-3 transition">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={toggle}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
        >
          {collapsed ? (
            <ChevronRight className="size-4 text-[var(--color-muted-foreground)] shrink-0" />
          ) : (
            <ChevronDown className="size-4 text-[var(--color-muted-foreground)] shrink-0" />
          )}
          <span className="font-semibold tracking-tight truncate">
            {data.project.name}
          </span>
          <span className="text-sm tabular-nums text-[var(--color-muted-foreground)]">
            {data.totalCount}
          </span>
        </button>
        <Link
          href={`/projects/${data.project.id}`}
          className="opacity-50 md:opacity-0 md:group-hover:opacity-100 hover:opacity-100 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] rounded p-1"
          title="Open project"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </div>

      {!collapsed ? (
        <div className="mt-2 grid gap-3 grid-cols-1 sm:grid-cols-3">
          {data.byList.map((g) => {
            const p = palette(g.list.color);
            const pending = pendingByList.get(g.list.id) ?? [];
            const visible = [...g.todos, ...pending].filter(
              (t) => !hidden.has(t.id)
            );
            const isOver = dragOverList === g.list.id;
            return (
              <div
                key={g.list.id}
                data-droptarget-list={g.list.id}
                data-droptarget-project={data.project.id}
                onDragOver={(e) => handleColumnDragOver(e, g.list.id)}
                onDragLeave={(e) => handleColumnDragLeave(e, g.list.id)}
                onDrop={(e) => handleColumnDrop(e, g.list.id)}
                className={cn(
                  "min-w-0 rounded-lg p-1.5 -m-1.5 ring-2 ring-transparent transition",
                  isOver && cn("bg-[var(--color-accent)]/40", p.ring)
                )}
              >
                <div
                  className={cn(
                    "text-xs font-semibold uppercase tracking-wider mb-1 px-1",
                    p.text
                  )}
                >
                  {g.list.name}
                  {visible.length > 0 ? (
                    <span className="ml-1.5 tabular-nums opacity-70">
                      {Math.max(g.totalCount, visible.length)}
                    </span>
                  ) : null}
                </div>
                {visible.length === 0 ? (
                  <div className="text-xs text-[var(--color-muted-foreground)]/70 italic px-1 py-1.5 min-h-[40px]">
                    {isOver ? "Drop here" : "—"}
                  </div>
                ) : (
                  <ul className="space-y-px -mx-1 min-h-[40px]">
                    {visible.map((t) => {
                      let display = overrides.has(t.id)
                        ? { ...t, completedAt: overrides.get(t.id) ?? null }
                        : t;
                      if (dueDateOverrides.has(t.id)) {
                        display = {
                          ...display,
                          dueDate: dueDateOverrides.get(t.id) ?? null,
                        };
                      }
                      const optimisticSubs = pendingSubtasks.get(t.id);
                      if (optimisticSubs?.length) {
                        const existing = display.subtasks ?? [];
                        const existingIds = new Set(
                          existing.map((s) => s.id),
                        );
                        const additions = optimisticSubs.filter(
                          (s) => !existingIds.has(s.id),
                        );
                        if (additions.length) {
                          display = {
                            ...display,
                            subtasks: [...existing, ...additions],
                          };
                        }
                      }
                      if (display.subtasks?.length && subtaskOverrides.size) {
                        let touched = false;
                        const subs = display.subtasks.map((s) => {
                          if (!subtaskOverrides.has(s.id)) return s;
                          touched = true;
                          return {
                            ...s,
                            completedAt:
                              subtaskOverrides.get(s.id) ?? null,
                          };
                        });
                        if (touched) display = { ...display, subtasks: subs };
                      }
                      return (
                        <TodoRow
                          key={t.id}
                          todo={display}
                          listColor={g.list.color}
                          sourceListId={g.list.id}
                          sourceProjectId={data.project.id}
                          onToggle={toggleComplete}
                          onToggleSubtask={toggleSubtask}
                          onAddSubtask={addSubtask}
                          onSaveDueDate={saveDueDate}
                          onDelete={deleteTodo}
                        />
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
