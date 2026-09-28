-- CreateTable
CREATE TABLE "CallSheetSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "sources" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheetSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheetContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "sourceData" JSONB NOT NULL DEFAULT '{}',
    "cadenceDays" INTEGER,
    "snoozedUntil" TIMESTAMP(3),
    "excludedAt" TIMESTAMP(3),
    "lastSuggestedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheetContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSheetDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "entries" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheetDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallSheetSettings_userId_key" ON "CallSheetSettings"("userId");

-- CreateIndex
CREATE INDEX "CallSheetContact_userId_snoozedUntil_idx" ON "CallSheetContact"("userId", "snoozedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CallSheetContact_userId_personId_key" ON "CallSheetContact"("userId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "CallSheetDay_userId_localDate_key" ON "CallSheetDay"("userId", "localDate");

-- AddForeignKey
ALTER TABLE "CallSheetSettings" ADD CONSTRAINT "CallSheetSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetContact" ADD CONSTRAINT "CallSheetContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetContact" ADD CONSTRAINT "CallSheetContact_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetDay" ADD CONSTRAINT "CallSheetDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

