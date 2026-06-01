-- AlterTable
ALTER TABLE "EventFollow" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "FilterExclusion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilterExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FilterExclusion_userId_idx" ON "FilterExclusion"("userId");

-- CreateIndex
CREATE INDEX "FilterExclusion_eventId_idx" ON "FilterExclusion"("eventId");

-- CreateIndex
CREATE INDEX "FilterExclusion_subscriptionId_idx" ON "FilterExclusion"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "FilterExclusion_userId_eventId_subscriptionId_key" ON "FilterExclusion"("userId", "eventId", "subscriptionId");

-- CreateIndex
CREATE INDEX "EventFollow_subscriptionId_idx" ON "EventFollow"("subscriptionId");

-- AddForeignKey
ALTER TABLE "FilterExclusion" ADD CONSTRAINT "FilterExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterExclusion" ADD CONSTRAINT "FilterExclusion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterExclusion" ADD CONSTRAINT "FilterExclusion_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
