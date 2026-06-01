-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "hubHostId" TEXT,
ADD COLUMN     "hubId" TEXT,
ADD COLUMN     "showOnMainCalendar" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EventHub" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPCOMING',
    "theme" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubHost" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "description" TEXT,
    "sourceAlias" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubHost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventHub_slug_key" ON "EventHub"("slug");

-- CreateIndex
CREATE INDEX "EventHub_status_start_idx" ON "EventHub"("status", "start");

-- CreateIndex
CREATE INDEX "HubHost_hubId_featured_idx" ON "HubHost"("hubId", "featured");

-- CreateIndex
CREATE UNIQUE INDEX "HubHost_hubId_slug_key" ON "HubHost"("hubId", "slug");

-- CreateIndex
CREATE INDEX "Event_hubId_idx" ON "Event"("hubId");

-- CreateIndex
CREATE INDEX "Event_hubHostId_idx" ON "Event"("hubHostId");

-- CreateIndex
CREATE INDEX "Event_showOnMainCalendar_idx" ON "Event"("showOnMainCalendar");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "EventHub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_hubHostId_fkey" FOREIGN KEY ("hubHostId") REFERENCES "HubHost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubHost" ADD CONSTRAINT "HubHost_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "EventHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;
