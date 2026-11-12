import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HomeTiles, type HomeTile } from "@/components/home-tiles";
import { NewListButton } from "@/components/new-list-button";
import { ImportGranolaButton } from "@/components/import-granola-button";
import { EcLanding } from "@/components/ec-landing";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { CaptureInboxPill } from "@/components/capture-inbox";
import { KeyboardListNav } from "@/components/keyboard-nav";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists } from "@/lib/lists";
import { getSession } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { isPrivateHost } from "@/lib/hosts";
import { listAccessWhere, listColorFor } from "@/lib/list-access";
import { commentStatsByTodo, creatorName, listSharing, todoMeta } from "@/lib/home-meta";
import type { TodoLike } from "@/components/todo-row";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();

  if (!session) {
    if (isPrivateHost((await headers()).get("host"))) redirect("/login");
    return <EcLanding />;
  }
  const userId = session.userId;

  await ensureDefaultLists(userId);
  // Granola import uses Eddie's personal API key, so only the founder sees it.
  const canImportGranola =
    !!process.env.GRANOLA_API_KEY?.trim() && (await isFounderUser(userId));

  // Single fetch for all open top-level todos plus their subtasks. Bucket in
  // memory rather than firing a query per list tile.
  const [lists, allTodos, comments, commentReads, pendingCaptures] = await Promise.all([
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
        // Undated todos stay in manual order on top; dated ones sink to the bottom.
        { dueDate: { sort: "asc", nulls: "first" } },
        { position: "asc" },
        { createdAt: "asc" },
      ],
      include: {
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
    // The Capture Inbox itself lives on /captures so it never sits between
    // the header and the lists; Home only shows how many captures are waiting.
    prisma.captureReview
      .count({ where: { userId, dismissedAt: null } })
      .catch(() => null),
  ]);

  // Per-todo comment stats: total count + unread (others' comments newer than
  // this user's last read of that thread). Shared with GET /api/todos.
  const commentStats = commentStatsByTodo(comments, commentReads, userId);

  const toLike = (t: (typeof allTodos)[number]): TodoLike => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    snoozedUntil: t.snoozedUntil,
    projectId: t.projectId,
    suggestedListId: t.suggestedListId,
    ...todoMeta(t, commentStats),
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      notes: s.notes,
      dueDate: s.dueDate,
      completedAt: s.completedAt,
      projectId: s.projectId,
      creatorName: creatorName(s),
    })),
  });

  // Bucket: list.id -> all open todos
  const byList = new Map<string, typeof allTodos>();
  for (const t of allTodos) {
    (byList.get(t.listId) ?? byList.set(t.listId, []).get(t.listId))!.push(t);
  }

  const tiles: HomeTile[] = lists.map((list) => {
    const all = byList.get(list.id) ?? [];
    // shared, ownerName, collaborative, sharedWithNames. Shared with GET /api/lists.
    const sharing = listSharing(list, userId);
    return {
      list: {
        id: list.id,
        name: list.name,
        // Members see their personal tile color when they've set one;
        // otherwise everyone sees the owner's color.
        color: listColorFor(list, userId),
        isDefault: list.isDefault,
        ...sharing,
      },
      todos: all.map(toLike),
      totalCount: all.length,
    };
  });

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6 hidden md:flex items-start justify-between gap-4">
        <div>
          <h1 className="text-large-title font-bold">Home</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Compiled across everything. Drag tasks between lists.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/captures"
            title="Capture Inbox"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-0.5 text-[11px] font-medium transition hover:border-[var(--color-foreground)]"
          >
            <Inbox className="size-4 text-[var(--color-muted-foreground)]" />
            <span>
              Captures
              {pendingCaptures ? (
                <>
                  {" · "}
                  <span className="font-semibold tabular-nums">{pendingCaptures}</span>
                </>
              ) : null}
            </span>
          </Link>
          <CaptureInboxPill />
          {canImportGranola ? <ImportGranolaButton /> : null}
          <NewListButton />
        </div>
      </header>
      <KeyboardListNav />
      <HomeTiles tiles={tiles} />
    </div>
  );
}
