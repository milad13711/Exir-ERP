-- سربرگ و قالب‌های نامه (افزودنی و idempotent). بدون enum جدید و بدون عبارت حساس به مالکیت.

CREATE TABLE IF NOT EXISTS "corr_letterheads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "backgroundImage" TEXT,
    "pageSize" TEXT NOT NULL DEFAULT 'A4',
    "orientation" TEXT NOT NULL DEFAULT 'portrait',
    "layoutJson" JSONB NOT NULL,
    "departmentId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "corr_letterheads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "corr_letterheads_isDefault_isActive_idx" ON "corr_letterheads"("isDefault", "isActive");
CREATE INDEX IF NOT EXISTS "corr_letterheads_departmentId_idx" ON "corr_letterheads"("departmentId");

CREATE TABLE IF NOT EXISTS "corr_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "letterType" TEXT NOT NULL DEFAULT 'ANY',
    "categoryId" TEXT,
    "subject" TEXT NOT NULL DEFAULT '',
    "bodyHtml" TEXT NOT NULL,
    "defaultLetterheadId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "corr_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "corr_templates_letterType_isActive_sortOrder_idx" ON "corr_templates"("letterType", "isActive", "sortOrder");
