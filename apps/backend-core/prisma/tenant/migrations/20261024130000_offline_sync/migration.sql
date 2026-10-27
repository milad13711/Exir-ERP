-- همگام‌سازی آفلاین (ماژول offline-sync): جدول Idempotency + ستون updatedAt برای مخاطب/کالا (تشخیص تعارض و دلتا).
-- فقط افزایشی؛ بدون تغییر مالکیت و بدون مقدار enum جدید.
ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "warehouse_products" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "sync_idempotency" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "resourceId" TEXT,
    "offlineCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_idempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sync_idempotency_userId_key_key" ON "sync_idempotency"("userId", "key");
CREATE INDEX IF NOT EXISTS "sync_idempotency_expiresAt_idx" ON "sync_idempotency"("expiresAt");
