-- وظایف: «دریافت‌شد» (تیک خاکستری) برای هر ارجاع‌گیرنده — فقط افزایشی، بدون تغییر مالکیت.
ALTER TABLE "task_assignees" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
-- ردیف‌های قبلیِ دیده‌شده قطعاً دریافت هم شده‌اند (seenAt ⇒ deliveredAt).
UPDATE "task_assignees" SET "deliveredAt" = "seenAt" WHERE "seenAt" IS NOT NULL AND "deliveredAt" IS NULL;

-- آرشیو فعالیت کاربر: جست‌وجوی «ماژول/نوع/موجودیت» در پروفایل کاربر. (ایندکس userId+createdAt از قبل وجود دارد.)
CREATE INDEX IF NOT EXISTS "activity_logs_userId_moduleCode_createdAt_idx" ON "activity_logs"("userId", "moduleCode", "createdAt");
CREATE INDEX IF NOT EXISTS "task_events_actorUserId_type_createdAt_idx" ON "task_events"("actorUserId", "type", "createdAt");
