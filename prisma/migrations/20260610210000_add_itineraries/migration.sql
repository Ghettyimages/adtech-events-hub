-- CreateTable
CREATE TABLE "Itinerary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "optionalHubId" TEXT,
    "gcalCalendarId" TEXT,
    "gcalSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gcalSyncPending" BOOLEAN NOT NULL DEFAULT false,
    "gcalLastSyncedAt" TIMESTAMP(3),
    "gcalLastSyncError" TEXT,
    "gcalLastSyncAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Itinerary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryItem" (
    "id" TEXT NOT NULL,
    "itineraryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventId" TEXT,
    "hubHostId" TEXT,
    "hubId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItineraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryExclusion" (
    "id" TEXT NOT NULL,
    "itineraryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItineraryExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Itinerary_userId_idx" ON "Itinerary"("userId");

-- CreateIndex
CREATE INDEX "Itinerary_gcalSyncPending_idx" ON "Itinerary"("gcalSyncPending");

-- CreateIndex
CREATE UNIQUE INDEX "Itinerary_userId_slug_key" ON "Itinerary"("userId", "slug");

-- CreateIndex
CREATE INDEX "ItineraryItem_itineraryId_idx" ON "ItineraryItem"("itineraryId");

-- CreateIndex
CREATE INDEX "ItineraryItem_eventId_idx" ON "ItineraryItem"("eventId");

-- CreateIndex
CREATE INDEX "ItineraryItem_hubHostId_idx" ON "ItineraryItem"("hubHostId");

-- CreateIndex
CREATE INDEX "ItineraryItem_hubId_idx" ON "ItineraryItem"("hubId");

-- CreateIndex
CREATE INDEX "ItineraryExclusion_itineraryId_idx" ON "ItineraryExclusion"("itineraryId");

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryExclusion_itineraryId_eventId_key" ON "ItineraryExclusion"("itineraryId", "eventId");

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_optionalHubId_fkey" FOREIGN KEY ("optionalHubId") REFERENCES "EventHub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_hubHostId_fkey" FOREIGN KEY ("hubHostId") REFERENCES "HubHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "EventHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryExclusion" ADD CONSTRAINT "ItineraryExclusion_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryExclusion" ADD CONSTRAINT "ItineraryExclusion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
