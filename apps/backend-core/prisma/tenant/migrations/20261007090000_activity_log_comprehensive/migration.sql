-- لاگ جامع فعالیت‌ها: نوع کنشگر (دستی/خودکار)، ماژول، نوع عمل، خلاصه‌ی فارسی و IP ماسک‌شده. افزودنی و بدون حذف داده.
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "actorType" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "moduleCode" TEXT;
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "actionType" TEXT;
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "ip" TEXT;

-- ردیف‌های قدیمی: ماژول از بخش اول action
UPDATE "activity_logs" SET "moduleCode" = split_part("action", '.', 1) WHERE "moduleCode" IS NULL;

CREATE INDEX IF NOT EXISTS "activity_logs_userId_createdAt_idx" ON "activity_logs"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "activity_logs_moduleCode_createdAt_idx" ON "activity_logs"("moduleCode", "createdAt");
CREATE INDEX IF NOT EXISTS "activity_logs_actorType_createdAt_idx" ON "activity_logs"("actorType", "createdAt");
