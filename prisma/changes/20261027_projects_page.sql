-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'auto';

-- CreateTable
CREATE TABLE "ExerciseVideo" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseVideo_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ProjectSource" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "homepageUrl" TEXT,
    "company" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3),
    "commits" JSONB NOT NULL DEFAULT '[]',
    "plan" JSONB NOT NULL DEFAULT '[]',
    "state" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,

    CONSTRAINT "ProjectSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMeeting" (
    "id" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "title" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT,
    "projectId" TEXT,

    CONSTRAINT "ProjectMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectSource_userId_lastActivityAt_idx" ON "ProjectSource"("userId", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSource_userId_kind_key_key" ON "ProjectSource"("userId", "kind", "key");

-- CreateIndex
CREATE INDEX "ProjectMeeting_userId_occurredAt_idx" ON "ProjectMeeting"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectMeeting_projectId_idx" ON "ProjectMeeting"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMeeting_userId_externalKey_key" ON "ProjectMeeting"("userId", "externalKey");

-- AddForeignKey
ALTER TABLE "ProjectSource" ADD CONSTRAINT "ProjectSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSource" ADD CONSTRAINT "ProjectSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMeeting" ADD CONSTRAINT "ProjectMeeting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMeeting" ADD CONSTRAINT "ProjectMeeting_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ProjectSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMeeting" ADD CONSTRAINT "ProjectMeeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

