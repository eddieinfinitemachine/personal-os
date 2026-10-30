-- CreateTable: todo agent jobs (triage on Vercel, scripts/agent-worker.ts on
-- the Mac). Additive and idempotent; safe to re-run.
-- NOT APPLIED to production yet: apply from up-to-date main before the PR merges.
-- Rollback: DROP TABLE IF EXISTS "AgentJob";
CREATE TABLE IF NOT EXISTS "AgentJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "todoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "plan" TEXT,
    "repo" TEXT,
    "branch" TEXT,
    "resultUrl" TEXT,
    "summary" TEXT,
    "resultJson" JSONB,
    "error" TEXT,
    "costUsd" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentJob_todoId_key" ON "AgentJob"("todoId");
CREATE INDEX IF NOT EXISTS "AgentJob_userId_createdAt_idx" ON "AgentJob"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentJob_status_idx" ON "AgentJob"("status");

DO $$ BEGIN
  ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "Todo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
