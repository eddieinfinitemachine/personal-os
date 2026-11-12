import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Captured todos also get the "Inbox" PROJECT, so the user sorts captures into
// real projects themselves rather than letting the AI pre-assign one.
export const INBOX_PROJECT_NAME = "Inbox";
// Everything captured (EC, Smart Capture, notebook scans, quick todos) lands
// in the "Inbox" LIST, with the AI's pick stored as Todo.suggestedListId.
export const INBOX_LIST_NAME = "Inbox";
// "To Do" is the list of things the user has decided to do: where renewal
// autopilot and meeting imports file todos, and the default suggestion for a
// capture the AI gave no list for.
export const CAPTURE_LIST_NAME = "To Do";

export const DEFAULT_LISTS = [
  { name: "To Do", color: "blue", position: 0 },
  { name: "Inbox", color: "zinc", position: 1 },
  { name: "Monitor", color: "orange", position: 2 },
  { name: "Later", color: "violet", position: 3 },
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

// Idempotent: ensures the default lists exist *for the given user* and
// their color/position match DEFAULT_LISTS. Per-user cache so we only hit the
// DB once per (user, server process).
const ensuredForUser = new Set<string>();
export async function ensureDefaultLists(userId: string): Promise<void> {
  if (ensuredForUser.has(userId)) return;
  for (const def of DEFAULT_LISTS) {
    const existing =
      def.name === INBOX_LIST_NAME
        ? await ensureInboxList(prisma, userId)
        : await prisma.list.findFirst({ where: { userId, isDefault: true, name: def.name } });
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

// The default Inbox list, created the first time it's needed. Accounts from
// before it existed get room made right after To Do (every list from that
// position down moves one place, so custom lists keep their order), and a
// list they already called "Inbox" becomes the default one instead of gaining
// a twin. A shared "Inbox" stays custom: default lists are never shared.
// Takes a client so capture commits can call it inside their transaction.
export async function ensureInboxList(
  db: Pick<Prisma.TransactionClient, "list">,
  userId: string,
) {
  const existing = await db.list.findFirst({
    where: { userId, isDefault: true, name: INBOX_LIST_NAME },
  });
  if (existing) return existing;
  const def = DEFAULT_LISTS.find((l) => l.name === INBOX_LIST_NAME)!;
  await db.list.updateMany({
    where: {
      userId,
      position: { gte: def.position },
      NOT: { isDefault: true, name: CAPTURE_LIST_NAME },
    },
    data: { position: { increment: 1 } },
  });
  const own = await db.list.findFirst({
    where: {
      userId,
      isDefault: false,
      name: { equals: INBOX_LIST_NAME, mode: "insensitive" },
      members: { none: {} },
    },
    orderBy: { createdAt: "asc" },
  });
  if (own) {
    return db.list.update({ where: { id: own.id }, data: { ...def, isDefault: true } });
  }
  return db.list.create({ data: { ...def, isDefault: true, userId } });
}

// Names of the lists a capture may be filed into for this user: their own
// plus shared lists they can edit, minus the Inbox itself. Passed to the
// capture parser so the AI can suggest one of them.
export async function captureListNames(userId: string): Promise<string[]> {
  const rows = await prisma.list.findMany({
    where: {
      OR: [
        { userId },
        { isDefault: false, members: { some: { userId, role: { in: ["editor", "admin"] } } } },
      ],
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { name: true },
  });
  const seen = new Set([INBOX_LIST_NAME.toLowerCase()]);
  const names: string[] = [];
  for (const { name } of rows) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name.trim());
  }
  return names;
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
