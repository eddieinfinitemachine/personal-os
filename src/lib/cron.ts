import { prisma } from "@/lib/prisma";

/**
 * Vercel Cron sets `Authorization: Bearer ${CRON_SECRET}` on requests when the
 * env var is set. We require it in production. In development, allow unsigned
 * requests so you can hit the endpoint by hand.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Lookup-or-create the synthetic project that holds AI-generated journal
 * notes (weekly recaps, etc.). Idempotent.
 */
export async function ensureJournalProject(): Promise<{ id: string }> {
  const existing = await prisma.project.findFirst({
    where: { name: "Journal", archived: false },
  });
  if (existing) return existing;
  return prisma.project.create({
    data: {
      name: "Journal",
      icon: "BookOpen",
      color: "violet",
      kind: "generic",
    },
  });
}

/**
 * Default top-of-list "To Do" list — where renewal autopilot drops todos.
 */
export async function getDefaultTodoList(): Promise<{ id: string } | null> {
  return prisma.list.findFirst({
    where: { isDefault: true, name: "To Do" },
  });
}
