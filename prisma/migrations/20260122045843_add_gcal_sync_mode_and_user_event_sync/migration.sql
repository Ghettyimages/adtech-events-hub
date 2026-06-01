-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gcalSyncMode" TEXT NOT NULL DEFAULT 'FULL';

-- CreateTable
CREATE TABLE "UserEventSync" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "gcalEventId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEventSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserEventSync_userId_idx" ON "UserEventSync"("userId");

-- CreateIndex
CREATE INDEX "UserEventSync_eventId_idx" ON "UserEventSync"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "UserEventSync_userId_eventId_key" ON "UserEventSync"("userId", "eventId");

-- AddForeignKey
ALTER TABLE "UserEventSync" ADD CONSTRAINT "UserEventSync_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEventSync" ADD CONSTRAINT "UserEventSync_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
