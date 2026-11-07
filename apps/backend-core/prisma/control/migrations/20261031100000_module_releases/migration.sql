-- اعلان به‌روزرسانی ماژول‌ها به تننت‌ها — فقط افزایشی؛ وضعیت‌ها TEXT (بدون مقدار enum جدید).
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "support_tickets_tenantId_sourceRef_key" ON "support_tickets"("tenantId", "sourceRef");

CREATE TABLE IF NOT EXISTS "module_releases" (
    "id" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedByAdminId" TEXT,
    "createdByAdminId" TEXT,
    "channels" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "module_releases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "module_releases_shortCode_key" ON "module_releases"("shortCode");
CREATE UNIQUE INDEX IF NOT EXISTS "module_releases_moduleCode_version_key" ON "module_releases"("moduleCode", "version");
CREATE INDEX IF NOT EXISTS "module_releases_status_publishedAt_idx" ON "module_releases"("status", "publishedAt");

CREATE TABLE IF NOT EXISTS "module_release_changes" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "valueText" TEXT NOT NULL DEFAULT '',
    "deepLink" TEXT,
    CONSTRAINT "module_release_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "module_release_changes_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "module_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "module_release_changes_releaseId_sortOrder_idx" ON "module_release_changes"("releaseId", "sortOrder");

CREATE TABLE IF NOT EXISTS "module_release_deliveries" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "module_release_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "module_release_deliveries_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "module_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "module_release_deliveries_releaseId_tenantId_channel_key" ON "module_release_deliveries"("releaseId", "tenantId", "channel");
CREATE INDEX IF NOT EXISTS "module_release_deliveries_releaseId_status_idx" ON "module_release_deliveries"("releaseId", "status");
CREATE INDEX IF NOT EXISTS "module_release_deliveries_tenantId_idx" ON "module_release_deliveries"("tenantId");
