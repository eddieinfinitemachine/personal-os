// Per-todo and per-list metadata the web Home shows: the paperclip, the
// comment bubble and its unread badge, "added by …", and the shared /
// collaborative chips. Used by both src/app/page.tsx and the JSON API
// (GET /api/todos, GET /api/lists) so the web Home and the native app can't
// drift apart.

type Person = { name: string | null; email: string };

const label = (u: Person) => u.name ?? u.email;

export type CommentStats = { count: number; unread: number };

/**
 * Comment count and unread count per todo id. Unread means comments by someone
 * else, newer than this user's CommentRead.lastReadAt for that todo (no read
 * row means every such comment is unread). Takes the rows of one comment query
 * and one commentRead query for the whole set, so callers stay at two queries
 * however many todos they show.
 */
export function commentStatsByTodo(
  comments: readonly { todoId: string; authorId: string; createdAt: Date }[],
  reads: readonly { todoId: string; lastReadAt: Date }[],
  userId: string,
): Map<string, CommentStats> {
  const lastReadByTodo = new Map(reads.map((r) => [r.todoId, r.lastReadAt.getTime()]));
  const stats = new Map<string, CommentStats>();
  for (const c of comments) {
    const s = stats.get(c.todoId) ?? { count: 0, unread: 0 };
    s.count++;
    if (c.authorId !== userId && c.createdAt.getTime() > (lastReadByTodo.get(c.todoId) ?? 0)) {
      s.unread++;
    }
    stats.set(c.todoId, s);
  }
  return stats;
}

/** The todo's creator, shown as "added by …" on collaborative lists. */
export function creatorName(todo: { user: Person | null }): string | null {
  return todo.user ? label(todo.user) : null;
}

/**
 * A top-level todo's Home metadata. The row needs `user: { name, email }` and
 * `_count: { attachments }` included; `stats` comes from commentStatsByTodo.
 */
export function todoMeta(
  todo: { id: string; user: Person | null; _count: { attachments: number } },
  stats: ReadonlyMap<string, CommentStats>,
) {
  const s = stats.get(todo.id);
  return {
    creatorName: creatorName(todo),
    attachmentCount: todo._count.attachments,
    commentCount: s?.count ?? 0,
    unreadCommentCount: s?.unread ?? 0,
  };
}

/**
 * A list's sharing metadata from this user's point of view. The row needs
 * `user: { name, email }`, every member with `user: { name, email }`, and
 * `_count: { members }` included.
 */
export function listSharing(
  list: {
    userId: string;
    user: Person;
    members: readonly { user: Person }[];
    _count: { members: number };
  },
  userId: string,
) {
  const shared = list.userId !== userId;
  return {
    shared,
    ownerName: shared ? label(list.user) : null,
    // A list is collaborative if it has any members: true for both the
    // owner's view (members > 0) and a member's view (they're in the set).
    collaborative: list._count.members > 0,
    // Owner's view: names of everyone the list is shared with.
    sharedWithNames: shared ? [] : list.members.map((m) => label(m.user)),
  };
}
