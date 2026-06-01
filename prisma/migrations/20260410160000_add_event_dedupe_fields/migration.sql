-- AlterTable
ALTER TABLE "Event" ADD COLUMN "dedupeFingerprint" TEXT,
ADD COLUMN "potentialDuplicateOfId" TEXT,
ADD COLUMN "duplicateReviewStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Event_dedupeFingerprint_key" ON "Event"("dedupeFingerprint");

-- CreateIndex
CREATE INDEX "Event_duplicateReviewStatus_idx" ON "Event"("duplicateReviewStatus");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_potentialDuplicateOfId_fkey" FOREIGN KEY ("potentialDuplicateOfId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
