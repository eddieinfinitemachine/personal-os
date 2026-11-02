-- Additive table for the iOS capture API. Apply once before deploying.
-- This repository has no migration baseline; this does not create one.
CREATE TABLE IF NOT EXISTS "MobileCaptureReceipt" (
  "id" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  CONSTRAINT "MobileCaptureReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MobileCaptureReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "MobileCaptureReceipt_userId_createdAt_idx" ON "MobileCaptureReceipt"("userId", "createdAt");
