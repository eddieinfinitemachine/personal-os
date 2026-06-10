"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Calendar, ChevronDown, ChevronRight, Eye, EyeOff, Folder, Home, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Loader2, MoreHorizontal, Settings, Trash2 } from "lucide-react";
import { AddTemplateButton, useEnabledTemplates } from "./sidebar-template-picker";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

type SidebarProject = {
  id: string;
  name: string;
  icon: string;
  _count: { todos: number };
};

export function Sidebar({
  projects: initialProjects,
  appName = "EC",
  isPrivate = false,
}: {
  projects: SidebarProject[];
  appName?: string;
  isPrivate?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [projects, setProjects] = useState(initialProjects);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  useEffect(() => {
    try {
      setCollapsed(
        localStorage.getItem("personalos:sidebar-collapsed") === "1"
      );
    } catch {}
  }, []);

  function setCollapsedPersisted(next: boolean) {
    setCollapsed(next);
    try {
      localStorage.setItem("personalos:sidebar-collapsed", next ? "1" : "0");
    } catch {}
  }

  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string>>(
    new Set()
  );
  const [hiddenOpen, setHiddenOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("personalos:hidden-projects");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr))
          setHiddenProjectIds(new Set(arr.filter((v) => typeof v === "string")));
      }
    } catch {}
  }, []);

  function toggleHidden(projectId: string) {
    setHiddenProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      try {
        localStorage.setItem(
          "personalos:hidden-projects",
          JSON.stringify([...next])
        );
      } catch {}
      return next;
    });
  }

  const visibleProjects = projects.filter((p) => !hiddenProjectIds.has(p.id));
  const hiddenProjects = projects.filter((p) => hiddenProjectIds.has(p.id));

  function moveTo(fromId: string, toId: string) {
    if (fromId === toId) return;
    setProjects((prev) => {
      const fromIdx = prev.findIndex((p) => p.id === fromId);
      const toIdx = prev.findIndex((p) => p.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  async function persistOrder() {
    const ids = projects.map((p) => p.id);
    setDraggingId(null);
    await fetch("/api/projects/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    startTransition(() => router.refresh());
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      const { project } = await res.json();
      setName("");
      setAdding(false);
      // Invalidate the shared menu cache so the next "Move to project"
      // picker open picks up this new project without waiting for a refresh.
      window.dispatchEvent(
        new CustomEvent("personalos:project-created", {
          detail: { project },
        }),
      );
      startTransition(() => {
        router.push(`/projects/${project.id}`);
        router.refresh();
      });
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsedPersisted(false)}
        title="Expand sidebar"
        aria-label="Expand sidebar"
        className="fixed top-3 left-3 z-30 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 shadow-sm hover:bg-[var(--color-accent)]"
      >
        <PanelLeftOpen className="size-4 text-[var(--color-muted-foreground)]" />
      </button>
    );
  }

  return (
    <aside className="w-64 shrink-0 border-r border-[var(--color-separator)] bg-[var(--color-fill-secondary)] flex flex-col min-h-screen">
      <div className="px-4 py-5 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {appName}
        </div>
        <button
          onClick={() => setCollapsedPersisted(true)}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <SidebarTemplatesNav pathname={pathname} isPrivate={isPrivate} />

      <div className="px-2 mt-4">
        <div className="px-2 mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Projects
          </span>
          <button
            onClick={() => setAdding(true)}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
            title="New project"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div className="space-y-0.5">
          {visibleProjects.map((project) => (
            <ProjectSidebarRow
              key={project.id}
              project={project}
              active={pathname === `/projects/${project.id}`}
              hidden={false}
              onToggleHidden={() => toggleHidden(project.id)}
              onDragStart={() => setDraggingId(project.id)}
              onDragOver={() => {
                if (!draggingId) return;
                moveTo(draggingId, project.id);
              }}
              onDrop={persistOrder}
              dragging={draggingId === project.id}
              onDeleted={() => {
                if (pathname === `/projects/${project.id}`) {
                  startTransition(() => {
                    router.push("/");
                    router.refresh();
                  });
                } else {
                  startTransition(() => router.refresh());
                }
              }}
              onTodoDropped={() => {
                startTransition(() => router.refresh());
              }}
              onRenamed={(newName) => {
                setProjects((prev) =>
                  prev.map((p) =>
                    p.id === project.id ? { ...p, name: newName } : p
                  )
                );
                startTransition(() => router.refresh());
              }}
            />
          ))}
          {hiddenProjects.length > 0 ? (
            <div className="pt-1">
              <button
                onClick={() => setHiddenOpen((v) => !v)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40 rounded"
              >
                {hiddenOpen ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                <span>Hidden</span>
                <span className="tabular-nums opacity-70">
                  {hiddenProjects.length}
                </span>
              </button>
              {hiddenOpen ? (
                <div className="space-y-0.5 mt-0.5 opacity-70">
                  {hiddenProjects.map((project) => (
                    <ProjectSidebarRow
                      key={project.id}
                      project={project}
                      active={pathname === `/projects/${project.id}`}
                      hidden
                      onToggleHidden={() => toggleHidden(project.id)}
                      onDeleted={() => {
                        if (pathname === `/projects/${project.id}`) {
                          startTransition(() => {
                            router.push("/");
                            router.refresh();
                          });
                        } else {
                          startTransition(() => router.refresh());
                        }
                      }}
                      onRenamed={(newName) => {
                        setProjects((prev) =>
                          prev.map((p) =>
                            p.id === project.id ? { ...p, name: newName } : p
                          )
                        );
                        startTransition(() => router.refresh());
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {adding ? (
            <form onSubmit={createProject} className="px-2 pt-1">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (!name.trim()) setAdding(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setAdding(false);
                    setName("");
                  }
                }}
                placeholder="Project name"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm focus:border-[var(--color-ring)] focus:outline-none"
              />
              {pending && (
                <Loader2 className="size-3 animate-spin mt-1 text-[var(--color-muted-foreground)]" />
              )}
            </form>
          ) : projects.length === 0 ? (
            <button
              onClick={() => setAdding(true)}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
            >
              + New project
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-auto border-t border-[var(--color-border)]">
        <BuildInfo />
        <div className="px-2 py-2 border-t border-[var(--color-border)]">
          <SidebarLink
            href="/settings"
            icon={<Settings className="size-4" />}
            label="Settings"
            active={pathname === "/settings"}
          />
        </div>
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Theme
          </span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

function BuildInfo() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;
  const [relative, setRelative] = useState<string>("");
  const absolute = buildTime ? new Date(buildTime) : null;

  useEffect(() => {
    if (!absolute) return;
    const tick = () => setRelative(formatRelative(absolute));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [absolute]);

  return (
    <div
      className="px-4 py-2 text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] flex items-center justify-between gap-2"
      title={absolute ? absolute.toLocaleString() : undefined}
    >
      <span>v{version}</span>
      {relative ? <span className="normal-case tracking-normal">Updated {relative}</span> : null}
    </div>
  );
}

function formatRelative(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SidebarTemplatesNav({
  pathname,
  isPrivate,
}: {
  pathname: string;
  isPrivate: boolean;
}) {
  const { enabled, available, add } = useEnabledTemplates(isPrivate);
  return (
    <nav className="px-2 pb-4 space-y-0.5">
      <SidebarLink
        href="/"
        icon={<Home className="size-4" />}
        label="Home"
        active={pathname === "/"}
      />
      <SidebarLink
        href="/calendar"
        icon={<Calendar className="size-4" />}
        label="Calendar"
        active={pathname === "/calendar"}
      />
      {enabled.map((t) => (
        <SidebarLink
          key={t.slug}
          href={t.href}
          icon={<t.Icon className="size-4" />}
          label={t.label}
          active={t.href === "/print/today" ? pathname === t.href : pathname.startsWith(t.href)}
        />
      ))}
      <AddTemplateButton available={available} onAdd={add} />
    </nav>
  );
}

function SidebarLink({
  href,
  icon,
  label,
  count,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
        active
          ? "bg-[var(--color-tint)]/12 text-[var(--color-tint)] font-medium"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
      )}
    >
      <span
        className={cn(
          active ? "text-[var(--color-tint)]" : "text-[var(--color-label-tertiary)]"
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 ? (
        <span
          className={cn(
            "text-xs tabular-nums",
            active
              ? "text-[var(--color-tint)]/80"
              : "text-[var(--color-muted-foreground)]"
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function ProjectSidebarRow({
  project,
  active,
  hidden,
  onToggleHidden,
  onDeleted,
  onDragStart,
  onDragOver,
  onDrop,
  onTodoDropped,
  onRenamed,
  dragging,
}: {
  project: SidebarProject;
  active: boolean;
  hidden?: boolean;
  onToggleHidden?: () => void;
  onDeleted: () => void;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onTodoDropped?: () => void;
  onRenamed?: (newName: string) => void;
  dragging?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [todoOver, setTodoOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function startRename() {
    setDraftName(project.name);
    setEditing(true);
    setMenuOpen(false);
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  async function commitRename() {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === project.name) {
      setEditing(false);
      setDraftName(project.name);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        onRenamed?.(trimmed);
      } else {
        setDraftName(project.name);
      }
    } catch {
      setDraftName(project.name);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  }

  async function deleteProject(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete project "${project.name}"? Any todos in it will move back to Home.`))
      return;
    setBusy(true);
    const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    setBusy(false);
    setMenuOpen(false);
    if (res.ok) onDeleted();
  }

  async function handleTodoDrop(e: React.DragEvent<HTMLDivElement>) {
    const raw = e.dataTransfer.getData("application/x-personalos-todo");
    if (!raw) return;
    let payload: {
      todoId: string;
      sourceListId?: string;
      sourceProjectId?: string | null;
      todo?: {
        id: string;
        title: string;
        notes?: string | null;
        dueDate?: Date | string | null;
        completedAt?: Date | string | null;
        projectId?: string | null;
      };
    } | null = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload?.todoId) return;
    if (payload.todo?.projectId === project.id) return;

    // Optimistic: emit the move in the standard event format BEFORE the PATCH
    // so list-tile/project-card can re-bucket the todo immediately. The list
    // doesn't change — only the project does.
    if (payload.sourceListId) {
      window.dispatchEvent(
        new CustomEvent("personalos:todo-moved", {
          detail: {
            todoId: payload.todoId,
            fromListId: payload.sourceListId,
            fromProjectId: payload.sourceProjectId ?? null,
            toListId: payload.sourceListId,
            toProjectId: project.id,
            toProjectName: project.name,
            todo: payload.todo,
          },
        })
      );
    }
    onTodoDropped?.();

    // Fire-and-forget — the optimistic event already updated the UI.
    fetch(`/api/todos/${payload.todoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    }).catch(() => {});
  }

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-personalos-project", project.id);
        onDragStart?.();
      }}
      onDragOver={(e) => {
        const types = e.dataTransfer.types;
        if (types.includes("application/x-personalos-todo")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!todoOver) setTodoOver(true);
          return;
        }
        if (!types.includes("application/x-personalos-project")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver?.();
      }}
      onDragLeave={() => {
        if (todoOver) setTodoOver(false);
      }}
      onDrop={(e) => {
        const types = e.dataTransfer.types;
        if (types.includes("application/x-personalos-todo")) {
          e.preventDefault();
          e.stopPropagation();
          setTodoOver(false);
          void handleTodoDrop(e);
          return;
        }
        if (!types.includes("application/x-personalos-project")) return;
        e.preventDefault();
        onDrop?.();
      }}
      className={cn(
        "group/row relative flex items-center rounded-md transition",
        active
          ? "bg-[var(--color-tint)]/12"
          : "hover:bg-[var(--color-accent)]",
        todoOver &&
          "ring-2 ring-[var(--color-ring)] bg-[var(--color-accent)]",
        dragging && "opacity-40"
      )}
    >
      {editing ? (
        <div className="flex-1 flex items-center gap-2 px-2 py-1.5 text-sm">
          <Folder className="size-4 text-[var(--color-muted-foreground)]" />
          <input
            ref={inputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
                setDraftName(project.name);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 rounded-sm border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-0.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
          />
        </div>
      ) : (
        <Link
          href={`/projects/${project.id}`}
          draggable={false}
          onDoubleClick={(e) => {
            e.preventDefault();
            startRename();
          }}
          className={cn(
            "flex-1 flex items-center gap-2 px-2 py-1.5 text-sm",
            active
              ? "text-[var(--color-tint)] font-medium"
              : "text-[var(--color-muted-foreground)] group-hover/row:text-[var(--color-foreground)]"
          )}
        >
          <Folder
            className={cn(
              "size-4",
              active
                ? "text-[var(--color-tint)]"
                : "text-[var(--color-label-tertiary)]"
            )}
            strokeWidth={1.75}
          />
          <span className="flex-1 truncate">{project.name}</span>
          {project._count.todos > 0 ? (
            <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
              {project._count.todos}
            </span>
          ) : null}
        </Link>
      )}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="rounded p-1 mr-1 text-[var(--color-muted-foreground)] opacity-50 md:opacity-0 md:group-hover/row:opacity-100 hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
        title="Project options"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <MoreHorizontal className="size-3.5" />
        )}
      </button>
      {menuOpen ? (
        <>
          <button
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
          />
          <div className="absolute right-1 top-full z-50 mt-1 w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg overflow-hidden">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                startRename();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-accent)]"
            >
              <Pencil className="size-3.5" /> Rename
            </button>
            {onToggleHidden ? (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  onToggleHidden();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-accent)]"
              >
                {hidden ? (
                  <>
                    <Eye className="size-3.5" /> Show in sidebar
                  </>
                ) : (
                  <>
                    <EyeOff className="size-3.5" /> Hide from sidebar
                  </>
                )}
              </button>
            ) : null}
            <button
              onClick={deleteProject}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-500 hover:bg-[var(--color-accent)]"
            >
              <Trash2 className="size-3.5" /> Delete project
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
