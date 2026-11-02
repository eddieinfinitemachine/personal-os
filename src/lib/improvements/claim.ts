import type { Improvement, Prisma } from "@prisma/client";

/** The slice of Prisma the improve worker uses (mockable in tests). */
export type ImprovementQueueDb = {
  improvement: {
    findFirst(args: Prisma.ImprovementFindFirstArgs): Promise<{ id: string } | null>;
    findUnique(args: Prisma.ImprovementFindUniqueArgs): Promise<Improvement | null>;
    updateMany(args: Prisma.ImprovementUpdateManyArgs): Promise<{ count: number }>;
  };
};

/** "ship": an approved needs_review row to merge; "implement": a queued request to build. */
export type ImprovementJobKind = "ship" | "implement";
export type ClaimedImprovement = { improvement: Improvement; kind: ImprovementJobKind };

const CLAIM_ATTEMPTS = 3;

/** Approved rows go first: Eddie is waiting on a tap he already made. */
const CLAIM_ORDER: { status: "approved" | "queued"; kind: ImprovementJobKind }[] = [
  { status: "approved", kind: "ship" },
  { status: "queued", kind: "implement" },
];

/**
 * Claims the oldest approved improvement (to ship), else the oldest queued one
 * (to implement), for one of `allowedEmails`, and marks it running. The
 * status-guarded updateMany means two workers can never claim the same row:
 * the loser sees count 0 and tries the next oldest.
 */
export async function claimNextImprovement(
  db: ImprovementQueueDb,
  options: { allowedEmails: string[]; now?: Date },
): Promise<ClaimedImprovement | null> {
  if (!options.allowedEmails.length) return null;
  for (const { status, kind } of CLAIM_ORDER) {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
      const next = await db.improvement.findFirst({
        where: { status, user: { email: { in: options.allowedEmails } } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!next) break;
      const { count } = await db.improvement.updateMany({
        where: { id: next.id, status },
        data: { status: "running", startedAt: options.now ?? new Date(), completedAt: null, error: null },
      });
      if (count === 1) {
        const improvement = await db.improvement.findUnique({ where: { id: next.id } });
        return improvement ? { improvement, kind } : null;
      }
    }
  }
  return null;
}

/** Fails improvements left "running" by a worker that died (sleep, crash, kill -9) before `olderThan`. */
export async function failStaleImprovements(db: ImprovementQueueDb, olderThan: Date, now = new Date()): Promise<number> {
  const { count } = await db.improvement.updateMany({
    where: { status: "running", startedAt: { lt: olderThan } },
    data: { status: "failed", error: "The improve worker stopped before this finished.", completedAt: now },
  });
  return count;
}

/** Puts a claimed improvement back where it was (the worker was asked to stop mid-run). */
export async function requeueImprovement(db: ImprovementQueueDb, id: string, kind: ImprovementJobKind): Promise<void> {
  await db.improvement.updateMany({
    where: { id, status: "running" },
    data: { status: kind === "ship" ? "approved" : "queued", startedAt: null },
  });
}
