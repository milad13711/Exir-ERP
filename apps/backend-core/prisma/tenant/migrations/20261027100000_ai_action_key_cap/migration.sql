-- سقف درخواست‌های تأیید معلق برای هر کلید API (افزودنی)
ALTER TABLE "ai_action_requests" ADD COLUMN IF NOT EXISTS "requestedByKeyId" TEXT;
CREATE INDEX IF NOT EXISTS "ai_action_requests_requestedByKeyId_status_idx" ON "ai_action_requests"("requestedByKeyId", "status");
