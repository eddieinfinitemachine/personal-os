-- CreateTable: one day of diet per user from their food app, by way of Apple
-- Health and the capture Shortcut (POST /api/capture/health).
-- Additive and idempotent; safe to re-run. The app tolerates the table being
-- absent (P2021 → the Health page shows no nutrition and the capture route
-- still saves vitals), so it can deploy first.
-- Rollback: DROP TABLE IF EXISTS "NutritionDay";
CREATE TABLE IF NOT EXISTS "NutritionDay" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "caloriesKcal" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "saturatedFatG" DOUBLE PRECISION,
    "fiberG" DOUBLE PRECISION,
    "sugarG" DOUBLE PRECISION,
    "sodiumMg" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'apple-health',
    "app" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "NutritionDay_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NutritionDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "NutritionDay_userId_date_key" ON "NutritionDay"("userId", "date");
CREATE INDEX IF NOT EXISTS "NutritionDay_userId_date_idx" ON "NutritionDay"("userId", "date");
