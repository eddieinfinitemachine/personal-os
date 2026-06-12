import { prisma } from "@/lib/prisma";
import { sendSharedListAddEmail } from "@/lib/email";

// Suppress email bursts (e.g. a multi-line paste creates one todo per line,
// one POST each). Keyed per recipient+list+creator; the first email's copy
// covers follow-on adds. In-memory, so per-serverless-instance only — the
// sequential paste requests reuse the warm instance in practice, and the
// worst case is an extra email or two.
const SUPPRESS_MS = 5 * 60 * 1000;
const lastSentAt = new Map<string, number>();

function shouldSend(key: string): boolean {
  const now = Date.now();
  const prev = lastSentAt.get(key);
  if (prev && now - prev < SUPPRESS_MS) return false;
  lastSentAt.set(key, now);
  // Keep the map from growing unbounded on long-lived instances.
  if (lastSentAt.size > 1000) {
    for (const [k, t] of lastSentAt) if (now - t > SUPPRESS_MS) lastSentAt.delete(k);
  }
  return true;
}

/**
 * Email every participant of a shared list (owner + members, except the
 * creator) that a new todo was added. No-op for non-shared lists. Never
 * throws — notifications must not break todo creation. Call via
 * `after(() => notifySharedListAdd(...))` so it runs post-response.
 */
export async function notifySharedListAdd({
  todoId,
  listId,
  creatorId,
}: {
  todoId: string;
  listId: string;
  creatorId: string;
}): Promise<void> {
  try {
    const list = await prisma.list.findUnique({
      where: { id: listId },
      select: {
        name: true,
        user: { select: { id: true, email: true, name: true } },
        members: {
          select: { user: { select: { id: true, email: true, name: true } } },
        },
      },
    });
    if (!list || list.members.length === 0) return; // not a shared list

    const todo = await prisma.todo.findUnique({
      where: { id: todoId },
      select: { title: true, user: { select: { name: true, email: true } } },
    });
    if (!todo) return;
    const creatorName = todo.user?.name ?? todo.user?.email ?? "Someone";

    const participants = [list.user, ...list.members.map((m) => m.user)];
    const seen = new Set<string>();
    const recipients = participants.filter((u) => {
      if (u.id === creatorId || seen.has(u.email)) return false;
      seen.add(u.email);
      return true;
    });

    await Promise.all(
      recipients.map(async (u) => {
        if (!shouldSend(`${u.id}:${listId}:${creatorId}`)) return;
        try {
          await sendSharedListAddEmail(u.email, {
            creatorName,
            todoTitle: todo.title,
            listName: list.name,
          });
        } catch (err) {
          console.error(
            `[notify] shared-list email to ${u.email} failed (list "${list.name}", todo "${todo.title}"):`,
            err,
          );
        }
      }),
    );
  } catch (err) {
    console.error("[notify] notifySharedListAdd failed:", err);
  }
}
