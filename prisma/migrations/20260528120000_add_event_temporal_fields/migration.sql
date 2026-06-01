-- AlterTable
ALTER TABLE "Event" ADD COLUMN "temporalKind" TEXT NOT NULL DEFAULT 'ALL_DAY';
ALTER TABLE "Event" ADD COLUMN "allDayStartDate" DATE;
ALTER TABLE "Event" ADD COLUMN "allDayEndDate" DATE;
ALTER TABLE "Event" ADD COLUMN "dateRepairedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Event_temporalKind_idx" ON "Event"("temporalKind");
