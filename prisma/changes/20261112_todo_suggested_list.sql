-- Todo.suggestedListId: captures now land in a default "Inbox" list, and the
-- list the AI picked is kept here as a suggestion a client accepts with
-- PATCH /api/todos/[id] { listId } (which clears it). From the 2026-11-12
-- capture Inbox change. Matches `prisma migrate diff` for the schema change.
-- Additive and nullable; idempotent, safe to re-run. Old code ignores the
-- column. The "Inbox" list itself is data, created lazily per user by
-- ensureDefaultLists, so it needs no SQL.
-- Rollback: ALTER TABLE "Todo" DROP COLUMN IF EXISTS "suggestedListId";
-- (drops the index and foreign key with it).
ALTER TABLE "Todo" ADD COLUMN IF NOT EXISTS "suggestedListId" TEXT;
CREATE INDEX IF NOT EXISTS "Todo_suggestedListId_idx" ON "Todo"("suggestedListId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Todo_suggestedListId_fkey') THEN
    ALTER TABLE "Todo" ADD CONSTRAINT "Todo_suggestedListId_fkey" FOREIGN KEY ("suggestedListId") REFERENCES "List"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
