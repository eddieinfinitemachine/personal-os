"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, ChevronDown, ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { LIST_PALETTE, palette } from "@/lib/lists";
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

  // Optimistic state: adds, hides, and per-field overrides — applied to
  // visibleTodos so the UI updates without waiting on router.refresh().
  const [pendingTodos, setPendingTodos] = useState<TodoLike[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [todoOverrides, setTodoOverrides] = useState<
    Map<string, Partial<TodoLike>>
  >(new Map());
  // Newly-added subtasks, keyed by parent todo id. Merged into the parent's
  // subtasks array in visibleTodos and deduped against server data so the
  // optimistic row hides itself once the next refresh includes it.
  const [pendingSubtasks, setPendingSubtasks] = useState<
    Map<string, TodoLike[]>
  >(new Map());
  // Optimistic subtask field overrides (e.g. toggleComplete). Applied per
  // subtask id when rendering. Dropped via useEffect once server matches.
  const [subtaskOverrides, setSubtaskOverrides] = useState<
    Map<string, Partial<TodoLike>>
  >(new Map());
  const [isDragOver, setIsDragOver] = useState(false);
  const [extraTodos, setExtraTodos] = useState<TodoLike[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // Reset the "show more" cache whenever the underlying todos prop changes
  // (router.refresh) so we don't show stale extras after a server re-fetch.
  useEffect(() => {
    setExtraTodos([]);
  }, [todos]);

  async function loadMore() {
    if (loadingMore || extraTodos.length > 0) return;
    setLoadingMore(true);
    try {
      const q = new URLSearchParams({ listId: list.id });
      if (projectId) q.set("projectId", projectId);
      const res = await fetch(`/api/todos?${q.toString()}`);
      if (!res.ok) return;
      const { todos: all } = (await res.json()) as { todos: TodoLike[] };
      const seen = new Set(todos.map((t) => t.id));
      setExtraTodos(all.filter((t) => !seen.has(t.id)));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    function handler(e: Event) {
      const ev = e as CustomEvent<{ listId: string }>;
      if (ev.detail?.listId !== list.id) return;
      setAdding(true);
    }
    window.addEventListener("personalos:start-add-todo", handler);
    return () =>
      window.removeEventListener("personalos:start-add-todo", handler);
  }, [list.id]);

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

  // Listen for move events so this tile updates immediately (without waiting
  // for router.refresh). A Home tile (myProjectKey null + groupByProject) shows
  // todos from every project, so a move that only changes the todo's project
  // keeps the row in this tile and re-buckets it via an override; a move that
  // changes the list takes the row out via hiddenIds.
  const myProjectKey = projectId ?? null;
  useEffect(() => {
    function handler(ev: Event) {
      const e = ev as CustomEvent<{
        todoId: string;
        fromListId: string;
        fromProjectId: string | null;
        toListId: string;
        toProjectId: string | null;
        toProjectName?: string | null;
      }>;
      if (!e.detail) return;
      const isInTileNow =
        e.detail.fromListId === list.id &&
        (myProjectKey === null || e.detail.fromProjectId === myProjectKey);
      const willBeInTile =
        e.detail.toListId === list.id &&
        (myProjectKey === null || e.detail.toProjectId === myProjectKey);
      if (isInTileNow && !willBeInTile) {
        setHiddenIds((prev) => {
          if (prev.has(e.detail.todoId)) return prev;
          const next = new Set(prev);
          next.add(e.detail.todoId);
          return next;
        });
      } else if (
        isInTileNow &&
        willBeInTile &&
        e.detail.toProjectId !== e.detail.fromProjectId
      ) {
        setTodoOverrides((prev) => {
          const next = new Map(prev);
          next.set(e.detail.todoId, {
            projectId: e.detail.toProjectId,
            projectName: e.detail.toProjectName ?? null,
          });
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
    // Drop todoOverrides once the server matches them (or the todo dropped
    // off this list).
    setTodoOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      const serverById = new Map(todos.map((t) => [t.id, t]));
      for (const [id, override] of prev) {
        const server = serverById.get(id);
        if (!server) {
          next.delete(id);
          continue;
        }
        let matches = true;
        for (const k of Object.keys(override) as (keyof TodoLike)[]) {
          if (server[k] !== override[k]) {
            matches = false;
            break;
          }
        }
        if (matches) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
    // Drop optimistic subtasks once the server confirms them on their parent.
    setPendingSubtasks((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      const serverById = new Map(todos.map((t) => [t.id, t]));
      for (const [parentId, optimistic] of prev) {
        const parent = serverById.get(parentId);
        if (!parent) {
          next.delete(parentId);
          continue;
        }
        const serverSubIds = new Set((parent.subtasks ?? []).map((s) => s.id));
        const remaining = optimistic.filter((s) => !serverSubIds.has(s.id));
        if (remaining.length === 0) next.delete(parentId);
        else if (remaining.length !== optimistic.length)
          next.set(parentId, remaining);
      }
      return next.size === prev.size ? prev : next;
    });
    // Drop subtask overrides once server data matches.
    setSubtaskOverrides((prev) => {
      if (prev.size === 0) return prev;
      const serverSubs = new Map<string, TodoLike>();
      for (const t of todos) {
        for (const s of t.subtasks ?? []) serverSubs.set(s.id, s);
      }
      const next = new Map(prev);
      for (const [id, override] of prev) {
        const server = serverSubs.get(id);
        if (!server) {
          next.delete(id);
          continue;
        }
        let matches = true;
        for (const k of Object.keys(override) as (keyof TodoLike)[]) {
          if (server[k] !== override[k]) {
            matches = false;
            break;
          }
        }
        if (matches) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [todos]);

  const visibleTodos = useMemo<TodoLike[]>(() => {
    // Pending (just-added) todos render at the bottom so new reminders
    // append in the user's reading order. Server sorts by createdAt ASC
    // tiebreaker, so post-refresh order matches the optimistic order.
    // Dedup by id: the dedup useEffect that prunes pendingTodos/extraTodos
    // runs after server refresh, but there are race windows (POST-then-refresh,
    // cross-tile drag events) where the same id sits in two arrays for a
    // render. Prefer the first occurrence so the server row wins.
    const seen = new Set<string>();
    const merged: TodoLike[] = [];
    for (const t of [...todos, ...extraTodos, ...pendingTodos]) {
      if (hiddenIds.has(t.id) || seen.has(t.id)) continue;
      seen.add(t.id);
      merged.push(t);
    }
    if (
      todoOverrides.size === 0 &&
      pendingSubtasks.size === 0 &&
      subtaskOverrides.size === 0
    )
      return merged;
    return merged.map((t) => {
      const fieldOverride = todoOverrides.get(t.id);
      const optimisticSubs = pendingSubtasks.get(t.id);
      let next = fieldOverride ? { ...t, ...fieldOverride } : t;
      if (optimisticSubs?.length) {
        const existing = next.subtasks ?? [];
        const existingIds = new Set(existing.map((s) => s.id));
        const additions = optimisticSubs.filter(
          (s) => !existingIds.has(s.id),
        );
        if (additions.length) {
          next = { ...next, subtasks: [...existing, ...additions] };
        }
      }
      if (next.subtasks?.length && subtaskOverrides.size > 0) {
        let touched = false;
        const subs = next.subtasks.map((s) => {
          const ov = subtaskOverrides.get(s.id);
          if (!ov) return s;
          touched = true;
          return { ...s, ...ov };
        });
        if (touched) next = { ...next, subtasks: subs };
      }
      return next;
    });
  }, [
    todos,
    pendingTodos,
    extraTodos,
    hiddenIds,
    todoOverrides,
    pendingSubtasks,
    subtaskOverrides,
  ]);

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
    setTodoOverrides((prev) => {
      const map = new Map(prev);
      map.set(id, { ...prev.get(id), completedAt: next });
      return map;
    });
    const rollback = () =>
      setTodoOverrides((prev) => {
        const map = new Map(prev);
        const existing = prev.get(id);
        if (!existing) return prev;
        const { completedAt: _, ...rest } = existing;
        if (Object.keys(rest).length === 0) map.delete(id);
        else map.set(id, rest);
        return map;
      });
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
    // Look up current completed state from server data + any in-flight
    // override so a rapid double-toggle still flips.
    let currentCompletedAt: Date | string | null = null;
    const existingOv = subtaskOverrides.get(subtaskId);
    if (existingOv && "completedAt" in existingOv) {
      currentCompletedAt = existingOv.completedAt ?? null;
    } else {
      outer: for (const t of todos) {
        for (const s of t.subtasks ?? []) {
          if (s.id === subtaskId) {
            currentCompletedAt = s.completedAt ?? null;
            break outer;
          }
        }
      }
    }
    const nextCompletedAt: Date | null = currentCompletedAt ? null : new Date();
    setSubtaskOverrides((prev) => {
      const next = new Map(prev);
      next.set(subtaskId, { ...prev.get(subtaskId), completedAt: nextCompletedAt });
      return next;
    });
    fetch(`/api/todos/${subtaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggleComplete: true }),
    })
      .then((res) => {
        if (res.ok) startTransition(() => router.refresh());
        else rollbackSubtaskToggle(subtaskId);
      })
      .catch(() => rollbackSubtaskToggle(subtaskId));
  }

  function saveDueDate(id: string, value: string | null) {
    // Optimistic override on the todo. value is a YYYY-MM-DD string from the
    // input element; Date conversion happens here so the UI can format it.
    const nextDate: Date | null = value ? new Date(value) : null;
    setTodoOverrides((prev) => {
      const map = new Map(prev);
      map.set(id, { ...prev.get(id), dueDate: nextDate });
      return map;
    });
    const rollback = () =>
      setTodoOverrides((prev) => {
        const map = new Map(prev);
        const existing = prev.get(id);
        if (!existing) return prev;
        const { dueDate: _drop, ...rest } = existing;
        if (Object.keys(rest).length === 0) map.delete(id);
        else map.set(id, rest);
        return map;
      });
    fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: value }),
    })
      .then((res) => {
        if (res.ok) startTransition(() => router.refresh());
        else rollback();
      })
      .catch(rollback);
  }

  function deleteTodo(id: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    fetch(`/api/todos/${id}`, { method: "DELETE" })
      .then((res) => {
        if (res.ok) startTransition(() => router.refresh());
        else
          setHiddenIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
      })
      .catch(() =>
        setHiddenIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      );
  }

  function rollbackSubtaskToggle(subtaskId: string) {
    setSubtaskOverrides((prev) => {
      const next = new Map(prev);
      const ov = next.get(subtaskId);
      if (!ov) return prev;
      const { completedAt: _ignored, ...rest } = ov;
      if (Object.keys(rest).length === 0) next.delete(subtaskId);
      else next.set(subtaskId, rest);
      return next;
    });
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
      projectId: null,
    };
    // Paint immediately.
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
        // Swap temp id with real one so the dedupe useEffect can match
        // against server data once it arrives.
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
        // Low-priority background sync so the next render naturally drops
        // the optimistic entry (see dedupe useEffect).
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

  async function changeColor(color: string) {
    setMenuOpen(false);
    const res = await fetch(`/api/lists/${list.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
    if (res.ok) startTransition(() => router.refresh());
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
      data-droptarget-list={list.id}
      data-droptarget-project={myProjectKey ?? ""}
      className={cn(
        "group/tile flex flex-col transition relative md:rounded-2xl md:bg-[var(--color-card)] md:px-4 md:pt-4 md:pb-2 md:ring-2 md:ring-transparent md:border md:border-[var(--color-border)]",
        list.isDefault && "md:min-h-[420px]",
        !adding && "md:cursor-pointer",
        isDragOver &&
          cn("md:bg-[var(--color-card)]", p.ring.replace("/50", "/70"))
      )}
    >
      {/* Mobile: Reminders-style — large bold colored title, no chrome. */}
      <h2
        className={cn(
          "md:hidden text-[34px] font-bold tracking-tight leading-[1.05] mb-3",
          p.text
        )}
      >
        {list.name}
      </h2>

      {/* Desktop header: flush-left title, all chrome on the right side. */}
      <div className="hidden md:flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex md:items-baseline md:gap-3 min-w-0">
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
        <div className="flex items-center gap-0.5">
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
                className="absolute right-0 top-full z-10 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-1.5 p-2">
                  {Object.keys(LIST_PALETTE).map((c) => {
                    const cp = LIST_PALETTE[c as keyof typeof LIST_PALETTE];
                    const active = c === list.color;
                    return (
                      <button
                        key={c}
                        onClick={() => changeColor(c)}
                        title={c}
                        className={cn(
                          "grid size-6 place-items-center rounded-full text-white transition hover:scale-110",
                          cp.dot
                        )}
                      >
                        {active ? <Check className="size-3.5" strokeWidth={3} /> : null}
                      </button>
                    );
                  })}
                </div>
                {!list.isDefault ? (
                  <button
                    onClick={deleteList}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-500 hover:bg-[var(--color-accent)] border-t border-[var(--color-border)]"
                  >
                    <Trash2 className="size-3.5" /> Delete list
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {/* Mobile-only: New Reminder input at the TOP of the tile (pre-1c1f088 behavior).
            The desktop counterpart still lives in-place at the bottom, below the list. */}
        <div className="md:hidden">
          {adding ? (
            <form onSubmit={addTodo} className="px-1 pt-1 pb-2">
              <div className="flex items-start gap-3 py-1">
                <span
                  className={cn(
                    "mt-0.5 size-6 shrink-0 rounded-full border-2 border-[var(--color-border)]"
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
                  placeholder="New Reminder"
                  className="flex-1 bg-transparent text-[17px] focus:outline-none placeholder:text-[var(--color-muted-foreground)]/70"
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
                "flex items-center gap-2.5 px-0 py-3 text-[17px] font-normal transition hover:opacity-80 text-left",
                p.text
              )}
            >
              <span
                className={cn(
                  "grid size-[22px] place-items-center rounded-full border-2 border-current",
                  p.softBg
                )}
              >
                <Plus className="size-3.5" strokeWidth={2.5} />
              </span>
              <span>New Reminder</span>
            </button>
          )}
        </div>

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
                      data-droptarget-list={list.id}
                      data-droptarget-project={groupProjectId ?? ""}
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
                        onPointerDown={(e) => e.stopPropagation()}
                        className="w-full flex items-center gap-1.5 px-0 py-3 text-[13px] md:text-[11px] font-medium md:font-semibold uppercase tracking-[0.06em] md:tracking-wider text-[var(--color-muted-foreground)] active:bg-[var(--color-accent)]/60 md:hover:bg-[var(--color-accent)]/40 rounded md:py-1"
                      >
                        <span className="truncate">{g.label}</span>
                        <span className="tabular-nums opacity-70">
                          {g.todos.length}
                        </span>
                        <span className="ml-auto">
                          {open ? (
                            <ChevronDown className="size-3" />
                          ) : (
                            <ChevronRight className="size-3" />
                          )}
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
                              onSaveDueDate={saveDueDate}
                              onDelete={deleteTodo}
                            />
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
                {totalCount > todos.length + extraTodos.length ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      loadMore();
                    }}
                    disabled={loadingMore}
                    className="px-2 py-2 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition"
                  >
                    {loadingMore
                      ? "Loading…"
                      : `+${totalCount - todos.length - extraTodos.length} more…`}
                  </button>
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
                onSaveDueDate={saveDueDate}
                onDelete={deleteTodo}
              />
            ))}
            {totalCount > todos.length + extraTodos.length ? (
              <li data-row className="-mx-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    loadMore();
                  }}
                  disabled={loadingMore}
                  className="px-2 py-2 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition"
                >
                  {loadingMore
                    ? "Loading…"
                    : `+${totalCount - todos.length - extraTodos.length} more…`}
                </button>
              </li>
            ) : null}
          </ul>
        )}

        {/* Desktop-only: original in-place add at the bottom. The mobile
            equivalent is rendered at the top of the tile (above). */}
        <div className="hidden md:block">
          {adding ? (
            <form onSubmit={addTodo} className="px-1 pt-1 pb-2">
              <div className="flex items-start gap-3 py-1">
                <span
                  className={cn(
                    "mt-0.5 size-[22px] shrink-0 rounded-full border-2 border-[var(--color-border)]"
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
                  placeholder="New Reminder"
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
                "flex items-center gap-2 px-2 py-2 mt-1 text-sm font-medium transition hover:opacity-80 text-left",
                p.text
              )}
            >
              <span
                className={cn(
                  "grid size-[22px] place-items-center rounded-full",
                  p.softBg
                )}
              >
                <Plus className="size-3.5" strokeWidth={2.5} />
              </span>
              <span>New Reminder</span>
            </button>
          )}
        </div>

        <div className="flex-1 min-h-[20px]" aria-hidden />
      </div>
    </div>
  );
}
