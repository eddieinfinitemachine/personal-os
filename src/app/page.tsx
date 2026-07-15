import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HomeTiles, type HomeTile } from "@/components/home-tiles";
import { NewListButton } from "@/components/new-list-button";
import { ProjectCard, type ProjectCardData } from "@/components/project-card";
import { KaizenLanding } from "@/components/kaizen-landing";
import { CaptureInboxPill } from "@/components/capture-inbox";
import { TriageLauncher } from "@/components/triage-mode";
import { KeyboardListNav } from "@/components/keyboard-nav";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists, INBOX_PROJECT_NAME } from "@/lib/lists";
import { getSession } from "@/lib/auth";
import { isPrivateHost } from "@/lib/hosts";
import { listAccessWhere } from "@/lib/list-access";
import type { TodoLike } from "@/components/todo-row";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();

  if (!session) {
    if (isPrivateHost((await headers()).get("host"))) redirect("/login");
    return <KaizenLanding />;
  }
  const userId = session.userId;

  await ensureDefaultLists(userId);

  // Single fetch for all open top-level todos plus their subtasks. Bucket in
  // memory rather than firing N×M queries per (list, project) tile.
  const [lists, projects, allTodos, comments, commentReads] = await Promise.all([
    prisma.list.findMany({
      where: listAccessWhere(userId),
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        user: { select: { id: true, name: true, email: true } },
        members: {
          include: { user: { select: { name: true, email: true } } },
        },
        _count: { select: { members: true } },
      },
    }),
    prisma.project.findMany({
      where: { userId, archived: false },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.todo.findMany({
      // Scope by list membership rather than direct ownership so todos in
      // shared lists appear (regardless of who created them).
      where: {
        completedAt: null,
        parentId: null,
        // Snoozed todos stay hidden until their resurface time passes.
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
        list: listAccessWhere(userId),
      },
      orderBy: [
        { dueDate: "asc" },
        { position: "asc" },
        { createdAt: "asc" },
      ],
      include: {
        project: { select: { name: true } },
        _count: { select: { attachments: true } },
        // Creator, surfaced as "added by …" on collaborative lists.
        user: { select: { name: true, email: true } },
        subtasks: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          include: { user: { select: { name: true, email: true } } },
        },
      },
    }),
    // Comment counts + unread badges. Volume is low (a handful of shared
    // lists), so we pull the rows and bucket in memory.
    prisma.comment.findMany({
      where: { todo: { list: listAccessWhere(userId) } },
      select: { todoId: true, authorId: true, createdAt: true },
    }),
    prisma.commentRead.findMany({
      where: { userId },
      select: { todoId: true, lastReadAt: true },
    }),
  ]);

  // Per-todo comment stats: total count + unread (others' comments newer than
  // this user's last read of that thread).
  const lastReadByTodo = new Map(
    commentReads.map((r) => [r.todoId, r.lastReadAt.getTime()]),
  );
  const commentStats = new Map<string, { count: number; unread: number }>();
  for (const c of comments) {
    const s = commentStats.get(c.todoId) ?? { count: 0, unread: 0 };
    s.count++;
    if (c.authorId !== userId && c.createdAt.getTime() > (lastReadByTodo.get(c.todoId) ?? 0)) {
      s.unread++;
    }
    commentStats.set(c.todoId, s);
  }

  const creatorLabel = (u: { name: string | null; email: string } | null) =>
    u ? u.name ?? u.email : null;

  const toLike = (t: (typeof allTodos)[number]): TodoLike => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    snoozedUntil: t.snoozedUntil,
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
    creatorName: creatorLabel(t.user),
    commentCount: commentStats.get(t.id)?.count ?? 0,
    attachmentCount: t._count.attachments,
    unreadCommentCount: commentStats.get(t.id)?.unread ?? 0,
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      notes: s.notes,
      dueDate: s.dueDate,
      completedAt: s.completedAt,
      projectId: s.projectId,
      creatorName: creatorLabel(s.user),
    })),
  });

  // Bucket: list.id -> all open todos
  const byList = new Map<string, typeof allTodos>();
  // Bucket: `${projectId}:${listId}` -> todos
  const byProjList = new Map<string, typeof allTodos>();
  for (const t of allTodos) {
    (byList.get(t.listId) ?? byList.set(t.listId, []).get(t.listId))!.push(t);
    if (t.projectId) {
      const k = `${t.projectId}:${t.listId}`;
      (byProjList.get(k) ?? byProjList.set(k, []).get(k))!.push(t);
    }
  }

  const tiles: HomeTile[] = lists.map((list) => {
    const all = byList.get(list.id) ?? [];
    const shared = list.userId !== userId;
    // A list is collaborative if it has any members — true for both the
    // owner's view (members > 0) and a member's view (they're in the set).
    const collaborative = list._count.members > 0;
    return {
      list: {
        id: list.id,
        name: list.name,
        color: list.color,
        isDefault: list.isDefault,
        shared,
        ownerName: shared ? list.user.name ?? list.user.email : null,
        collaborative,
        // Owner's view: names of everyone the list is shared with.
        sharedWithNames: shared
          ? []
          : list.members.map((m) => m.user.name ?? m.user.email),
      },
      todos: all.map(toLike),
      totalCount: all.length,
    };
  });

  // Project cards only show the canonical 3 lists (To Do, Monitor, Later).
  const projectLists = lists.filter((l) => l.isDefault);
  const projectCards: ProjectCardData[] = projects
    .map((project): ProjectCardData | null => {
      const byListForProject = projectLists.map((list) => {
        const all = byProjList.get(`${project.id}:${list.id}`) ?? [];
        return {
          list: { id: list.id, name: list.name, color: list.color },
          todos: all.map(toLike),
          totalCount: all.length,
        };
      });
      const total = byListForProject.reduce((s, g) => s + g.totalCount, 0);
      if (total === 0) return null;
      return {
        project: { id: project.id, name: project.name, kind: project.kind },
        byList: byListForProject,
        totalCount: total,
      };
    })
    .filter((c): c is ProjectCardData => c !== null);

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6 hidden md:flex items-start justify-between gap-4">
        <div>
          <h1 className="text-large-title font-bold">Home</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Compiled across everything. Drag tiles to reorder, drag tasks
            between lists.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CaptureInboxPill />
          <NewListButton />
        </div>
      </header>
      {(() => {
        // Attention row: two buttons that drop straight into the keyboard
        // triage flows (j/k to move, single keys to file/complete/drop —
        // email-style). Counts derive from rows already fetched.
        const inboxProject = projects.find(
          (p) => p.name === INBOX_PROJECT_NAME
        );
        const inboxCount = inboxProject
          ? allTodos.filter((t) => t.projectId === inboxProject.id).length
          : 0;
        const cutoff = Date.now() - 14 * 864e5;
        const staleCount = allTodos.filter(
          (t) => t.createdAt.getTime() < cutoff
        ).length;
        if (!inboxCount && !staleCount) return null;
        return (
          <div className="mb-4 flex items-center gap-2">
            {inboxCount && inboxProject ? (
              <TriageLauncher projectId={inboxProject.id} count={inboxCount} />
            ) : null}
            <TriageLauncher mode="stale" staleCount={staleCount} />
          </div>
        );
      })()}
      <KeyboardListNav />
      <HomeTiles tiles={tiles} />

      {projectCards.length > 0 ? (
        <section className="mt-8 hidden md:block">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] mb-3">
            By project
          </h2>
          <div className="space-y-3">
            {projectCards.map((c) => (
              <ProjectCard key={c.project.id} data={c} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
