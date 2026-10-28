import type { Prisma, ResearchReport } from "@prisma/client";

/** The slice of Prisma the worker's queue helpers use (mockable in tests). */
export type ResearchQueueDb = {
  researchReport: {
    findFirst(args: Prisma.ResearchReportFindFirstArgs): Promise<{ id: string } | null>;
    findUnique(args: Prisma.ResearchReportFindUniqueArgs): Promise<ResearchReport | null>;
    updateMany(args: Prisma.ResearchReportUpdateManyArgs): Promise<{ count: number }>;
  };
};

const CLAIM_ATTEMPTS = 3;

/**
 * Claims the oldest queued report for one of `allowedEmails` and marks it
 * running. The status-guarded updateMany means two workers can never claim the
 * same row: the loser sees count 0 and tries the next oldest.
 */
export async function claimNextReport(
  db: ResearchQueueDb,
  options: { allowedEmails: string[]; now?: Date },
): Promise<ResearchReport | null> {
  if (!options.allowedEmails.length) return null;
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const next = await db.researchReport.findFirst({
      where: { status: "queued", user: { email: { in: options.allowedEmails } } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!next) return null;
    const { count } = await db.researchReport.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running", startedAt: options.now ?? new Date(), error: null },
    });
    if (count === 1) return db.researchReport.findUnique({ where: { id: next.id } });
  }
  return null;
}

/** Fails reports left "running" by a worker that died (sleep, crash, kill -9) before `olderThan`. */
export async function failStaleReports(db: ResearchQueueDb, olderThan: Date, now = new Date()): Promise<number> {
  const { count } = await db.researchReport.updateMany({
    where: { status: "running", startedAt: { lt: olderThan } },
    data: { status: "failed", error: "The research worker stopped before this report finished.", completedAt: now },
  });
  return count;
}

/** Puts a claimed report back in the queue (the worker was asked to stop mid-run). */
export async function requeueReport(db: ResearchQueueDb, id: string): Promise<void> {
  await db.researchReport.updateMany({
    where: { id, status: "running" },
    data: { status: "queued", startedAt: null },
  });
}
