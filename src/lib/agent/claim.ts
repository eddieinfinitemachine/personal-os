import type { AgentJob, Prisma } from "@prisma/client";

/** The slice of Prisma the worker's queue helpers use (mockable in tests). */
export type AgentQueueDb = {
  agentJob: {
    findFirst(args: Prisma.AgentJobFindFirstArgs): Promise<{ id: string } | null>;
    findUnique(args: Prisma.AgentJobFindUniqueArgs): Promise<AgentJob | null>;
    updateMany(args: Prisma.AgentJobUpdateManyArgs): Promise<{ count: number }>;
    aggregate(args: Prisma.AgentJobAggregateArgs): Promise<{ _sum?: { costUsd?: number | null } }>;
  };
};

const CLAIM_ATTEMPTS = 3;

/**
 * Claims the oldest queued code job for one of `allowedEmails` and marks it
 * running. The status-guarded updateMany means two workers can never claim the
 * same row: the loser sees count 0 and tries the next oldest.
 */
export async function claimNextJob(
  db: AgentQueueDb,
  options: { allowedEmails: string[]; now?: Date },
): Promise<AgentJob | null> {
  if (!options.allowedEmails.length) return null;
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const next = await db.agentJob.findFirst({
      where: { status: "queued", kind: "code", user: { email: { in: options.allowedEmails } } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!next) return null;
    const { count } = await db.agentJob.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running", startedAt: options.now ?? new Date(), error: null },
    });
    if (count === 1) return db.agentJob.findUnique({ where: { id: next.id } });
  }
  return null;
}

/** Fails jobs left "running" by a worker that died (sleep, crash, kill -9) before `olderThan`. */
export async function failStaleJobs(db: AgentQueueDb, olderThan: Date, now = new Date()): Promise<number> {
  const { count } = await db.agentJob.updateMany({
    where: { status: "running", startedAt: { lt: olderThan } },
    data: { status: "failed", error: "The agent worker stopped before this job finished.", completedAt: now },
  });
  return count;
}

/** Puts a claimed job back in the queue (the worker was asked to stop mid-run). */
export async function requeueJob(db: AgentQueueDb, id: string): Promise<void> {
  await db.agentJob.updateMany({ where: { id, status: "running" }, data: { status: "queued", startedAt: null } });
}

/** Dollars spent by jobs that finished in the last 24 hours (the daily cap). */
export async function spentLastDay(db: AgentQueueDb, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 86_400_000);
  const { _sum } = await db.agentJob.aggregate({ where: { completedAt: { gte: since } }, _sum: { costUsd: true } });
  return _sum?.costUsd ?? 0;
}
