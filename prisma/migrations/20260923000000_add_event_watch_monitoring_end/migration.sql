ALTER TABLE "MonitoredUrl"
ADD COLUMN "monitoringEndsAt" TIMESTAMP(3);

CREATE INDEX "MonitoredUrl_enabled_monitoringEndsAt_idx"
ON "MonitoredUrl"("enabled", "monitoringEndsAt");
