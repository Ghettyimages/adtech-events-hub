-- Additive Event Watch history. Existing scans and candidates stay in place.
ALTER TABLE "MonitoredUrl"
ADD COLUMN "httpEtag" TEXT,
ADD COLUMN "httpLastModified" TEXT,
ADD COLUMN "processedHttpEtag" TEXT,
ADD COLUMN "processedHttpLastModified" TEXT,
ADD COLUMN "fetchedContentHash" TEXT,
ADD COLUMN "processedContentHash" TEXT,
ADD COLUMN "lastFetchedAt" TIMESTAMP(3),
ADD COLUMN "lastFullScanAt" TIMESTAMP(3),
ADD COLUMN "fullVerificationIntervalMs" INTEGER NOT NULL DEFAULT 604800000,
ADD COLUMN "requiresBrowser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "monitorDetailPages" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "detailPageHashes" TEXT,
ADD COLUMN "scanClaimedAt" TIMESTAMP(3),
ADD COLUMN "scanClaimToken" TEXT;

ALTER TABLE "EventWatchScan"
ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'RUNNING',
ADD COLUMN "fullExtractionRan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "skipReason" TEXT,
ADD COLUMN "changedEvents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unchangedEvents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "baselinesEstablished" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "contentHash" TEXT,
ADD COLUMN "httpStatus" INTEGER,
ADD COLUMN "summary" TEXT,
ADD COLUMN "historyQuality" TEXT NOT NULL DEFAULT 'DETAILED';

ALTER TABLE "EventWatchCandidate"
ADD COLUMN "historyQuality" TEXT NOT NULL DEFAULT 'DETAILED';

-- Earlier checks did not store immutable before/after results. Do not invent them.
UPDATE "EventWatchScan"
SET
  "historyQuality" = 'LEGACY',
  "outcome" = CASE
    WHEN "status" = 'FAILED' THEN 'FAILED'
    WHEN "status" = 'RUNNING' THEN 'INCOMPLETE'
    ELSE 'LEGACY'
  END,
  "summary" = CASE
    WHEN "status" = 'FAILED' THEN 'Scan failed. Detailed before/after results were not recorded for this earlier check.'
    WHEN "status" = 'RUNNING' THEN 'This earlier check did not finish. Detailed results were not recorded.'
    ELSE 'Earlier check. Detailed before/after results were not recorded and cannot be reconstructed.'
  END,
  "fullExtractionRan" = CASE WHEN "extractionMethod" IS NULL THEN false ELSE true END;

UPDATE "EventWatchCandidate"
SET "historyQuality" = 'LEGACY';

CREATE TABLE "EventWatchObservation" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "monitoredUrlId" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "contentFingerprint" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "evidence" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventWatchObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventWatchIdentity" (
  "id" TEXT NOT NULL,
  "monitoredUrlId" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "identityKind" TEXT NOT NULL,
  "eventId" TEXT,
  "pendingEventId" TEXT,
  "baselineEstablishedAt" TIMESTAMP(3),
  "ambiguous" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventWatchIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventWatchChangeProposal" (
  "id" TEXT NOT NULL,
  "monitoredUrlId" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "previousValues" JSONB NOT NULL,
  "proposedValues" JSONB NOT NULL,
  "changedFields" JSONB NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "evidence" TEXT,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "signature" TEXT NOT NULL,
  "eventUpdatedAtSnapshot" TIMESTAMP(3) NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventWatchChangeProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventWatchSchedulerRun" (
  "id" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "outcome" TEXT NOT NULL DEFAULT 'RUNNING',
  "sourcesDue" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  CONSTRAINT "EventWatchSchedulerRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventWatchObservation_scanId_idx" ON "EventWatchObservation"("scanId");
CREATE INDEX "EventWatchObservation_monitoredUrlId_stableKey_createdAt_idx" ON "EventWatchObservation"("monitoredUrlId", "stableKey", "createdAt");
CREATE UNIQUE INDEX "EventWatchIdentity_monitoredUrlId_stableKey_key" ON "EventWatchIdentity"("monitoredUrlId", "stableKey");
CREATE INDEX "EventWatchIdentity_eventId_idx" ON "EventWatchIdentity"("eventId");
CREATE INDEX "EventWatchIdentity_pendingEventId_idx" ON "EventWatchIdentity"("pendingEventId");
CREATE INDEX "EventWatchChangeProposal_eventId_signature_reviewStatus_idx" ON "EventWatchChangeProposal"("eventId", "signature", "reviewStatus");
CREATE INDEX "EventWatchChangeProposal_reviewStatus_createdAt_idx" ON "EventWatchChangeProposal"("reviewStatus", "createdAt");
CREATE INDEX "EventWatchChangeProposal_scanId_idx" ON "EventWatchChangeProposal"("scanId");
CREATE INDEX "EventWatchChangeProposal_monitoredUrlId_createdAt_idx" ON "EventWatchChangeProposal"("monitoredUrlId", "createdAt");
CREATE INDEX "EventWatchSchedulerRun_startedAt_idx" ON "EventWatchSchedulerRun"("startedAt");

ALTER TABLE "EventWatchObservation"
ADD CONSTRAINT "EventWatchObservation_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "EventWatchScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventWatchObservation"
ADD CONSTRAINT "EventWatchObservation_monitoredUrlId_fkey"
FOREIGN KEY ("monitoredUrlId") REFERENCES "MonitoredUrl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventWatchIdentity"
ADD CONSTRAINT "EventWatchIdentity_monitoredUrlId_fkey"
FOREIGN KEY ("monitoredUrlId") REFERENCES "MonitoredUrl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventWatchIdentity"
ADD CONSTRAINT "EventWatchIdentity_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventWatchIdentity"
ADD CONSTRAINT "EventWatchIdentity_pendingEventId_fkey"
FOREIGN KEY ("pendingEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventWatchChangeProposal"
ADD CONSTRAINT "EventWatchChangeProposal_monitoredUrlId_fkey"
FOREIGN KEY ("monitoredUrlId") REFERENCES "MonitoredUrl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventWatchChangeProposal"
ADD CONSTRAINT "EventWatchChangeProposal_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "EventWatchScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventWatchChangeProposal"
ADD CONSTRAINT "EventWatchChangeProposal_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
