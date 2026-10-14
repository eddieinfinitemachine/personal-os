-- AlterTable: stable external ids for interactions written by EC Pad
-- (POST /api/capture/activities upserts by (userId, externalKey)).
-- Additive and idempotent; safe to re-run. Existing rows keep NULL, and
-- Postgres treats NULLs as distinct, so the unique index cannot conflict.
-- NOT APPROVED for production yet: apply only after Eddie signs off.
-- Rollback: DROP INDEX IF EXISTS "Interaction_userId_externalKey_key";
--           ALTER TABLE "Interaction" DROP COLUMN IF EXISTS "externalKey";
ALTER TABLE "Interaction" ADD COLUMN IF NOT EXISTS "externalKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Interaction_userId_externalKey_key" ON "Interaction"("userId", "externalKey");
