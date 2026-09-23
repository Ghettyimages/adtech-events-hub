-- Extend the existing monitored source registry without changing Event temporal fields.
ALTER TABLE "MonitoredUrl"
ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'EVENT_CALENDAR',
ADD COLUMN "authority" TEXT NOT NULL DEFAULT 'OFFICIAL',
ADD COLUMN "adapterType" TEXT NOT NULL DEFAULT 'GENERIC',
ADD COLUMN "region" TEXT,
ADD COLUMN "topics" TEXT,
ADD COLUMN "nextCheckAt" TIMESTAMP(3),
ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "EventWatchScan" (
  "id" TEXT NOT NULL,
  "monitoredUrlId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "extractionMethod" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "eventsFound" INTEGER NOT NULL DEFAULT 0,
  "newEvents" INTEGER NOT NULL DEFAULT 0,
  "matchedEvents" INTEGER NOT NULL DEFAULT 0,
  "skippedEvents" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "extractedPayload" JSONB,
  CONSTRAINT "EventWatchScan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventWatchCandidate" (
  "id" TEXT NOT NULL,
  "monitoredUrlId" TEXT NOT NULL,
  "latestScanId" TEXT NOT NULL,
  "pendingEventId" TEXT,
  "matchedEventId" TEXT,
  "candidateKey" TEXT NOT NULL,
  "matchStatus" TEXT NOT NULL,
  "matchReason" TEXT,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "candidatePayload" JSONB NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "evidence" TEXT,
  "confidence" DOUBLE PRECISION,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  CONSTRAINT "EventWatchCandidate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MonitoredUrl_enabled_nextCheckAt_idx" ON "MonitoredUrl"("enabled", "nextCheckAt");
CREATE INDEX "EventWatchScan_monitoredUrlId_startedAt_idx" ON "EventWatchScan"("monitoredUrlId", "startedAt");
CREATE INDEX "EventWatchScan_status_startedAt_idx" ON "EventWatchScan"("status", "startedAt");
CREATE UNIQUE INDEX "EventWatchCandidate_monitoredUrlId_candidateKey_key" ON "EventWatchCandidate"("monitoredUrlId", "candidateKey");
CREATE INDEX "EventWatchCandidate_reviewStatus_lastSeenAt_idx" ON "EventWatchCandidate"("reviewStatus", "lastSeenAt");
CREATE INDEX "EventWatchCandidate_pendingEventId_idx" ON "EventWatchCandidate"("pendingEventId");
CREATE INDEX "EventWatchCandidate_matchedEventId_idx" ON "EventWatchCandidate"("matchedEventId");

ALTER TABLE "EventWatchScan"
ADD CONSTRAINT "EventWatchScan_monitoredUrlId_fkey"
FOREIGN KEY ("monitoredUrlId") REFERENCES "MonitoredUrl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventWatchCandidate"
ADD CONSTRAINT "EventWatchCandidate_monitoredUrlId_fkey"
FOREIGN KEY ("monitoredUrlId") REFERENCES "MonitoredUrl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventWatchCandidate"
ADD CONSTRAINT "EventWatchCandidate_latestScanId_fkey"
FOREIGN KEY ("latestScanId") REFERENCES "EventWatchScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventWatchCandidate"
ADD CONSTRAINT "EventWatchCandidate_pendingEventId_fkey"
FOREIGN KEY ("pendingEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventWatchCandidate"
ADD CONSTRAINT "EventWatchCandidate_matchedEventId_fkey"
FOREIGN KEY ("matchedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
