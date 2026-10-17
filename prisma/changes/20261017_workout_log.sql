-- CreateTable: the workout log (one row per finished guided session, set by set).
-- Additive and idempotent; safe to re-run. The app tolerates the table being
-- absent (P2021 → the log stays on the device), so it can deploy first.
-- NOT APPROVED for production yet: apply only after Eddie signs off.
-- Rollback: DROP TABLE IF EXISTS "WorkoutLog";
CREATE TABLE IF NOT EXISTS "WorkoutLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "focus" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "exercises" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "WorkoutLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkoutLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutLog_userId_clientId_key" ON "WorkoutLog"("userId", "clientId");
CREATE INDEX IF NOT EXISTS "WorkoutLog_userId_finishedAt_idx" ON "WorkoutLog"("userId", "finishedAt");
