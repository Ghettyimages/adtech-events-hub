-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "location" TEXT,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "timezone" TEXT,
    "source" TEXT,
    "tags" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "subscribers" INTEGER NOT NULL DEFAULT 0,
    "submittedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("city", "country", "createdAt", "description", "end", "id", "location", "region", "source", "start", "status", "subscribers", "tags", "timezone", "title", "updatedAt", "url") SELECT "city", "country", "createdAt", "description", "end", "id", "location", "region", "source", "start", "status", "subscribers", "tags", "timezone", "title", "updatedAt", "url" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
