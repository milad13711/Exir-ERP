-- آلارم یادآوری تقویم: ساعت مشخص، پیش‌هشدار، تکرار، تعویق و وضعیت (افزودنی؛ بدون تغییر مالکیت)
ALTER TABLE "dashboard_reminders"
  ADD COLUMN "remindAt" TIMESTAMP(3),
  ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "channels" TEXT[] DEFAULT ARRAY['IN_APP', 'PUSH']::TEXT[],
  ADD COLUMN "leadMinutes" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
  ADD COLUMN "alertsSentMin" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "repeatRule" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "seriesId" TEXT,
  ADD COLUMN "nextSpawned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "snoozedUntil" TIMESTAMP(3),
  ADD COLUMN "firedAt" TIMESTAMP(3),
  ADD COLUMN "lastFiredAt" TIMESTAMP(3),
  ADD COLUMN "smsSentAt" TIMESTAMP(3),
  ADD COLUMN "doneAt" TIMESTAMP(3);

-- ردیف‌های قدیمی (فقط تاریخ): تمام‌روز، ساعت ۰۸:۰۰ تهران (= ۰۴:۳۰ UTC). برای جلوگیری از
-- آلارم ناگهانیِ قدیمی‌ها، آن‌هایی که امروز یا قبل‌تر بوده‌اند «انجام‌شده» علامت می‌خورند.
UPDATE "dashboard_reminders"
SET "remindAt" = ("date"::date)::timestamp + INTERVAL '4 hours 30 minutes',
    "allDay" = true,
    "alertsSentMin" = CASE WHEN "date"::date <= CURRENT_DATE THEN ARRAY[0]::INTEGER[] ELSE ARRAY[]::INTEGER[] END
WHERE "remindAt" IS NULL;

CREATE INDEX "dashboard_reminders_status_remindAt_idx" ON "dashboard_reminders"("status", "remindAt");
CREATE INDEX "dashboard_reminders_createdByUserId_remindAt_idx" ON "dashboard_reminders"("createdByUserId", "remindAt");
