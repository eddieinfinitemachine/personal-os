-- User-approved additive Capture Inbox storage. Existing records need no migration.
CREATE TABLE "CaptureReview" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "requestHash" TEXT,
  "input" JSONB NOT NULL,
  "proposal" JSONB,
  "placement" JSONB NOT NULL,
  "effects" JSONB NOT NULL,
  "dismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "CaptureReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaptureReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CaptureReview_userId_dismissedAt_createdAt_idx" ON "CaptureReview"("userId", "dismissedAt", "createdAt");
