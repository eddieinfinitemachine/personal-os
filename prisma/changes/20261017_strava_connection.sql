-- CreateTable: one Strava account per user, for pulling activities into the
-- workout log. Additive and idempotent; safe to re-run. Without it, Strava
-- reads as "not connected" and connecting reports an error.
-- Rollback: DROP TABLE IF EXISTS "StravaConnection";
CREATE TABLE IF NOT EXISTS "StravaConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "athleteName" TEXT,
    "scope" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StravaConnection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StravaConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "StravaConnection_userId_key" ON "StravaConnection"("userId");
