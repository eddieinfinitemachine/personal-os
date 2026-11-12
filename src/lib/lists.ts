import { prisma } from "@/lib/prisma";
import { nextTodoPosition } from "@/lib/todo-position";

// Smart Capture files todos into the "Inbox" PROJECT (on the To Do list) so the
// user sorts captures into real projects themselves, rather than letting the AI
// pre-assign a project/list.
export const INBOX_PROJECT_NAME = "Inbox";
export const CAPTURE_LIST_NAME = "To Do";
// The default "Inbox" LIST that captures briefly landed in (November 2026).
// It's retired: ensureDefaultLists folds it back into To Do.
const RETIRED_INBOX_LIST_NAME = "Inbox";

export const DEFAULT_LISTS = [
  { name: "To Do", color: "blue", position: 0 },
  { name: "Monitor", color: "orange", position: 1 },
  { name: "Later", color: "violet", position: 2 },
] as const;

// Each list color resolves to a bundle of static Tailwind classes so the
// JIT picks them up. iOS Reminders styling uses dot, text, ring (for the
// hovered checkbox), and a soft tint for hover backgrounds.
export const LIST_PALETTE = {
  blue: {
    dot: "bg-blue-500",
    text: "text-blue-500",
    ring: "ring-blue-500/50",
    hoverBorder: "hover:border-blue-500",
    softBg: "bg-blue-500/10",
    fill: "bg-blue-500 border-blue-500",
  },
  amber: {
    dot: "bg-amber-500",
    text: "text-amber-500",
    ring: "ring-amber-500/50",
    hoverBorder: "hover:border-amber-500",
    softBg: "bg-amber-500/10",
    fill: "bg-amber-500 border-amber-500",
  },
  zinc: {
    dot: "bg-zinc-500",
    text: "text-zinc-400",
    ring: "ring-zinc-400/50",
    hoverBorder: "hover:border-zinc-400",
    softBg: "bg-zinc-500/10",
    fill: "bg-zinc-500 border-zinc-500",
  },
  emerald: {
    dot: "bg-emerald-500",
    text: "text-emerald-500",
    ring: "ring-emerald-500/50",
    hoverBorder: "hover:border-emerald-500",
    softBg: "bg-emerald-500/10",
    fill: "bg-emerald-500 border-emerald-500",
  },
  rose: {
    dot: "bg-rose-500",
    text: "text-rose-500",
    ring: "ring-rose-500/50",
    hoverBorder: "hover:border-rose-500",
    softBg: "bg-rose-500/10",
    fill: "bg-rose-500 border-rose-500",
  },
  violet: {
    dot: "bg-violet-500",
    text: "text-violet-500",
    ring: "ring-violet-500/50",
    hoverBorder: "hover:border-violet-500",
    softBg: "bg-violet-500/10",
    fill: "bg-violet-500 border-violet-500",
  },
  cyan: {
    dot: "bg-cyan-500",
    text: "text-cyan-500",
    ring: "ring-cyan-500/50",
    hoverBorder: "hover:border-cyan-500",
    softBg: "bg-cyan-500/10",
    fill: "bg-cyan-500 border-cyan-500",
  },
  orange: {
    dot: "bg-orange-500",
    text: "text-orange-500",
    ring: "ring-orange-500/50",
    hoverBorder: "hover:border-orange-500",
    softBg: "bg-orange-500/10",
    fill: "bg-orange-500 border-orange-500",
  },
} as const;

export type ListColor = keyof typeof LIST_PALETTE;

export function isListColor(v: unknown): v is ListColor {
  return typeof v === "string" && v in LIST_PALETTE;
}

export function palette(color: string) {
  return LIST_PALETTE[(color as ListColor) in LIST_PALETTE ? (color as ListColor) : "zinc"];
}

// Idempotent: ensures the three default lists exist *for the given user* and
// their color/position match DEFAULT_LISTS. Per-user cache so we only hit the
// DB once per (user, server process).
const ensuredForUser = new Set<string>();
export async function ensureDefaultLists(userId: string): Promise<void> {
  if (ensuredForUser.has(userId)) return;
  await retireInboxLists(userId);
  for (const def of DEFAULT_LISTS) {
    const existing = await prisma.list.findFirst({
      where: { userId, isDefault: true, name: def.name },
    });
    if (!existing) {
      await prisma.list.create({ data: { ...def, isDefault: true, userId } });
    } else if (existing.color !== def.color || existing.position !== def.position) {
      await prisma.list.update({
        where: { id: existing.id },
        data: { color: def.color, position: def.position },
      });
    }
  }
  ensuredForUser.add(userId);
}

// Folds each default Inbox list (there can be two: concurrent requests each
// created one) back into To Do: its todos go after To Do's own, in their
// order, without a list suggestion; suggestions pointing at it are cleared;
// the list is deleted and every list below it moves up one, undoing the room
// made for it. A custom list the user named "Inbox" isn't default and stays.
// One transaction per list, which starts by locking the list row: a concurrent
// retire waits, then finds the row gone and does nothing. A todo written into
// the list meanwhile is either committed first and moved, or waits and then
// fails on the missing list; it's never deleted along with it.
async function retireInboxLists(userId: string): Promise<void> {
  const inboxes = await prisma.list.findMany({
    where: { userId, isDefault: true, name: RETIRED_INBOX_LIST_NAME },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  for (const { id } of inboxes) {
    await prisma.$transaction(async (tx) => {
      const [inbox] = await tx.$queryRaw<Array<{ position: number }>>`SELECT "position" FROM "List" WHERE "id" = ${id} FOR UPDATE`;
      if (!inbox) return;
      const def = DEFAULT_LISTS.find((l) => l.name === CAPTURE_LIST_NAME)!;
      const toDo =
        (await tx.list.findFirst({
          where: { userId, isDefault: true, name: CAPTURE_LIST_NAME },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })) ?? (await tx.list.create({ data: { ...def, isDefault: true, userId } }));
      const todos = await tx.todo.findMany({
        where: { listId: id, parentId: null },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      const first = await nextTodoPosition(tx, toDo.id);
      for (const [i, todo] of todos.entries()) {
        await tx.todo.update({
          where: { id: todo.id },
          data: { listId: toDo.id, suggestedListId: null, position: first + i },
        });
      }
      // Subtasks follow their parents and keep their own positions.
      await tx.todo.updateMany({ where: { listId: id }, data: { listId: toDo.id, suggestedListId: null } });
      await tx.todo.updateMany({ where: { suggestedListId: id }, data: { suggestedListId: null } });
      await tx.list.delete({ where: { id } });
      await tx.list.updateMany({
        where: { userId, position: { gt: inbox.position } },
        data: { position: { decrement: 1 } },
      });
    }, { timeout: 20_000 });
  }
}

// Idempotent: ensures the "Inbox" project exists for this user and returns its
// id. Smart Capture files todos here so the user triages them into real
// projects later. Per-user cache, same as ensureDefaultLists.
const inboxProjectForUser = new Map<string, string>();
export async function ensureInboxProject(userId: string): Promise<string> {
  const cached = inboxProjectForUser.get(userId);
  if (cached) return cached;
  let project = await prisma.project.findFirst({
    where: { userId, name: { equals: INBOX_PROJECT_NAME, mode: "insensitive" } },
  });
  if (!project) {
    project = await prisma.project.create({
      data: { userId, name: INBOX_PROJECT_NAME, icon: "Inbox", color: "neutral", position: 0 },
    });
  }
  inboxProjectForUser.set(userId, project.id);
  return project.id;
}
