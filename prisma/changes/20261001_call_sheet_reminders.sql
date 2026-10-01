-- AlterTable: user-set call sheet reminders ("put Grace on my call sheet Tuesday").
-- Additive and idempotent; safe to re-run.
ALTER TABLE "CallSheetContact" ADD COLUMN IF NOT EXISTS "dueOn" TEXT;
ALTER TABLE "CallSheetContact" ADD COLUMN IF NOT EXISTS "dueNote" TEXT;
