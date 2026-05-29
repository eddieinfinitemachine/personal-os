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
 * Lookup the founder user for system-level (cron/admin/bearer) endpoints
 * that don't carry a session. Returns null if not found.
 */
export async function getFounderUser(): Promise<{ id: string; email: string } | null> {
  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  return prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
}

/**
 * True if the given (session) userId is the founder. Used to gate
 * founder-only integrations that rely on a single shared service token
 * (e.g. the Dropbox root-namespace token), which must never be reachable
 * by other tenants.
 */
export async function isFounderUser(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const founder = await getFounderUser();
  return !!founder && founder.id === userId;
}

/**
 * Lookup-or-create the synthetic project that holds AI-generated journal
 * notes (weekly recaps, etc.). Idempotent. Scoped to the given user.
 */
export async function ensureJournalProject(userId: string): Promise<{ id: string }> {
  const existing = await prisma.project.findFirst({
    where: { userId, name: "Journal", archived: false },
  });
  if (existing) return existing;
  return prisma.project.create({
    data: {
      userId,
      name: "Journal",
      icon: "BookOpen",
      color: "violet",
      kind: "generic",
    },
  });
}

/**
 * Default top-of-list "To Do" list — where renewal autopilot drops todos.
 * Scoped to the given user.
 */
export async function getDefaultTodoList(userId: string): Promise<{ id: string } | null> {
  return prisma.list.findFirst({
    where: { userId, isDefault: true, name: "To Do" },
  });
}
