-- CreateTable: shared cache of exercise demo videos (no personal data).
-- From the 2026-10-11 workout videos change, which documented this statement
-- in tasks/todo.md. Idempotent; the app works without it (no cache).
-- Rollback: DROP TABLE IF EXISTS "ExerciseVideo";
CREATE TABLE IF NOT EXISTS "ExerciseVideo" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExerciseVideo_pkey" PRIMARY KEY ("key")
);
