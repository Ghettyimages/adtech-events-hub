-- CreateTable
CREATE TABLE "HubCalendarSync" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "gcalCalendarId" TEXT,
    "gcalSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gcalSyncPending" BOOLEAN NOT NULL DEFAULT false,
    "gcalLastSyncedAt" TIMESTAMP(3),
    "gcalLastSyncError" TEXT,
    "gcalLastSyncAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubCalendarSync_pkey" PRIMARY KEY ("id")
);

-- Add gcalCalendarId to UserEventSync (nullable first for backfill)
ALTER TABLE "UserEventSync" ADD COLUMN "gcalCalendarId" TEXT;

-- Backfill from user's main Google calendar
UPDATE "UserEventSync" ues
SET "gcalCalendarId" = u."gcalCalendarId"
FROM "User" u
WHERE ues."userId" = u.id
  AND u."gcalCalendarId" IS NOT NULL;

-- Remove sync rows that cannot be attributed to a calendar
DELETE FROM "UserEventSync" WHERE "gcalCalendarId" IS NULL;

-- Make gcalCalendarId required
ALTER TABLE "UserEventSync" ALTER COLUMN "gcalCalendarId" SET NOT NULL;

-- Drop old unique constraint and add scoped unique
DROP INDEX IF EXISTS "UserEventSync_userId_eventId_key";
CREATE UNIQUE INDEX "UserEventSync_userId_eventId_gcalCalendarId_key" ON "UserEventSync"("userId", "eventId", "gcalCalendarId");
CREATE INDEX "UserEventSync_userId_gcalCalendarId_idx" ON "UserEventSync"("userId", "gcalCalendarId");

-- HubCalendarSync indexes
CREATE UNIQUE INDEX "HubCalendarSync_userId_hubId_key" ON "HubCalendarSync"("userId", "hubId");
CREATE INDEX "HubCalendarSync_gcalSyncPending_idx" ON "HubCalendarSync"("gcalSyncPending");

-- Foreign keys
ALTER TABLE "HubCalendarSync" ADD CONSTRAINT "HubCalendarSync_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HubCalendarSync" ADD CONSTRAINT "HubCalendarSync_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "EventHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;
