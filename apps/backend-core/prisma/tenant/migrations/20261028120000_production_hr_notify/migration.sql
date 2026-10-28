-- تولید: ویرایش/بایگانی فرمول و ایستگاه؛ منابع انسانی: گزارش پیامک تصمیم درخواست‌ها — فقط افزایشی، بدون تغییر مالکیت.
ALTER TABLE "production_boms" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "production_boms" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "production_work_centers" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "hr_request_sms_logs" (
    "id" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "requesterEmployeeId" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "maskedPhone" TEXT,
    "parts" INTEGER NOT NULL DEFAULT 0,
    "claimKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_request_sms_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_request_sms_logs_claimKey_key" ON "hr_request_sms_logs"("claimKey");
CREATE INDEX IF NOT EXISTS "hr_request_sms_logs_requestType_requestId_idx" ON "hr_request_sms_logs"("requestType", "requestId");
CREATE INDEX IF NOT EXISTS "hr_request_sms_logs_createdAt_idx" ON "hr_request_sms_logs"("createdAt");
