-- CreateTable: changes requested from the sidebar's Improve button (implemented
-- by scripts/improve-worker.ts on the Mac). Additive and idempotent; safe to re-run.
-- NOT APPLIED to production yet: apply from up-to-date main before the PR merges.
-- Rollback: DROP TABLE IF EXISTS "Improvement";
CREATE TABLE IF NOT EXISTS "Improvement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "context" JSONB,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "reviewReason" TEXT,
    "branch" TEXT,
    "prUrl" TEXT,
    "previewUrl" TEXT,
    "mergedSha" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Improvement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Improvement_userId_createdAt_idx" ON "Improvement"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Improvement_status_idx" ON "Improvement"("status");

DO $$ BEGIN
  ALTER TABLE "Improvement" ADD CONSTRAINT "Improvement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
