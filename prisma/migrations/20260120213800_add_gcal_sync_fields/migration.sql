-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gcalCalendarId" TEXT,
ADD COLUMN     "gcalLastSyncAttemptAt" TIMESTAMP(3),
ADD COLUMN     "gcalLastSyncError" TEXT,
ADD COLUMN     "gcalLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "gcalSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gcalSyncPending" BOOLEAN NOT NULL DEFAULT false;
