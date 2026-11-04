-- The Health page's generated picture (src/lib/health/picture.ts).
-- Additive and nullable. Rollback: DROP COLUMN both.
ALTER TABLE "Human" ADD COLUMN IF NOT EXISTS "pictureJson" JSONB;
ALTER TABLE "Human" ADD COLUMN IF NOT EXISTS "pictureAt" TIMESTAMP(3);
