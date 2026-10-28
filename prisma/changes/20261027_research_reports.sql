-- CreateTable: illustrated research reports for /research (made by
-- scripts/research-worker.ts on the Mac). Additive and idempotent; safe to re-run.
-- NOT APPLIED to production yet: apply from up-to-date main before the PR merges.
-- Rollback: DROP TABLE IF EXISTS "ResearchReport";
CREATE TABLE IF NOT EXISTS "ResearchReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "pdfUrl" TEXT,
    "pageCount" INTEGER,
    "sourcesJson" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ResearchReport_userId_createdAt_idx" ON "ResearchReport"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ResearchReport_status_idx" ON "ResearchReport"("status");

DO $$ BEGIN
  ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
