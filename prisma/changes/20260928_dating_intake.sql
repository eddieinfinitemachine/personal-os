-- AlterTable
ALTER TABLE "DatingEvent" ADD COLUMN     "machineContentHash" TEXT,
ADD COLUMN     "sourceRecordId" TEXT;

-- AlterTable
ALTER TABLE "DatingSuggestion" ADD COLUMN     "candidateId" TEXT,
ADD COLUMN     "draft" JSONB,
ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'granola',
ADD COLUMN     "sourceFingerprint" TEXT,
ADD COLUMN     "sourceRecordId" TEXT;

-- CreateTable
CREATE TABLE "DatingSourceState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "manifestVersion" INTEGER NOT NULL DEFAULT 0,
    "pairingHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_connected',
    "version" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastNewDataAt" TIMESTAMP(3),
    "coverageStart" TIMESTAMP(3),
    "coverageEnd" TIMESTAMP(3),
    "backlog" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatingSourceState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatingSourceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "segmentCount" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "evidenceFamily" TEXT,
    "payload" JSONB,
    "extraction" JSONB,
    "status" TEXT NOT NULL DEFAULT 'receiving',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatingSourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatingCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identities" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "personId" TEXT,
    "reviewedFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatingCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DatingSourceState_pairingHash_key" ON "DatingSourceState"("pairingHash");

-- CreateIndex
CREATE UNIQUE INDEX "DatingSourceState_tokenHash_key" ON "DatingSourceState"("tokenHash");

-- CreateIndex
CREATE INDEX "DatingSourceState_userId_status_idx" ON "DatingSourceState"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DatingSourceState_userId_source_scope_key" ON "DatingSourceState"("userId", "source", "scope");

-- CreateIndex
CREATE INDEX "DatingSourceRecord_stateId_status_idx" ON "DatingSourceRecord"("stateId", "status");

-- CreateIndex
CREATE INDEX "DatingSourceRecord_userId_stateId_externalId_documentVersio_idx" ON "DatingSourceRecord"("userId", "stateId", "externalId", "documentVersion");

-- CreateIndex
CREATE INDEX "DatingSourceRecord_status_retryAt_idx" ON "DatingSourceRecord"("status", "retryAt");

-- CreateIndex
CREATE UNIQUE INDEX "DatingSourceRecord_userId_stateId_externalId_revision_segme_key" ON "DatingSourceRecord"("userId", "stateId", "externalId", "revision", "segmentIndex");

-- CreateIndex
CREATE INDEX "DatingCandidate_userId_status_idx" ON "DatingCandidate"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DatingCandidate_userId_identityKey_key" ON "DatingCandidate"("userId", "identityKey");

-- CreateIndex
CREATE INDEX "DatingEvent_sourceRecordId_idx" ON "DatingEvent"("sourceRecordId");

-- CreateIndex
CREATE INDEX "DatingSuggestion_sourceRecordId_idx" ON "DatingSuggestion"("sourceRecordId");

-- CreateIndex
CREATE INDEX "DatingSuggestion_candidateId_idx" ON "DatingSuggestion"("candidateId");

-- AddForeignKey
ALTER TABLE "DatingEvent" ADD CONSTRAINT "DatingEvent_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "DatingSourceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatingSuggestion" ADD CONSTRAINT "DatingSuggestion_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "DatingSourceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatingSuggestion" ADD CONSTRAINT "DatingSuggestion_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "DatingCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatingSourceState" ADD CONSTRAINT "DatingSourceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatingSourceRecord" ADD CONSTRAINT "DatingSourceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatingSourceRecord" ADD CONSTRAINT "DatingSourceRecord_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "DatingSourceState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatingCandidate" ADD CONSTRAINT "DatingCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatingCandidate" ADD CONSTRAINT "DatingCandidate_personId_fkey" FOREIGN KEY ("personId") REFERENCES "DatingPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

