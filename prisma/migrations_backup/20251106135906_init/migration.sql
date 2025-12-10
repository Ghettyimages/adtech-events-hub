-- CreateTable
CREATE TABLE "MonitoredUrl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastChecked" DATETIME,
    "lastSuccess" DATETIME,
    "lastError" TEXT,
    "checkInterval" INTEGER NOT NULL DEFAULT 86400000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredUrl_url_key" ON "MonitoredUrl"("url");
