-- پوش/PWA: تحویل اعلان (ack)، دستگاه‌های اشتراک، تلاش‌های ارسال، ترجیح هر دسته و ساعات سکوت — فقط افزایشی، بدون تغییر مالکیت.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "entityType" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "deliveredVia" TEXT;
CREATE INDEX IF NOT EXISTS "notifications_entityType_entityId_idx" ON "notifications"("entityType", "entityId");

ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "categoryPrefs" JSONB;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "quietStart" TEXT NOT NULL DEFAULT '22:00';
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "quietEnd" TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "smsFallbackEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "label" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "lastSuccessAt" TIMESTAMP(3);
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "lastFailureAt" TIMESTAMP(3);
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "failureCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "vapidKeyHash" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "rotateNonce" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "lastRotateAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

CREATE TABLE IF NOT EXISTS "push_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "pushId" TEXT NOT NULL,
    "notificationId" TEXT,
    "category" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'push',
    "status" TEXT NOT NULL,
    "httpCode" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "claimKey" TEXT,
    CONSTRAINT "push_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "push_attempts_userId_createdAt_idx" ON "push_attempts"("userId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "push_attempts_claimKey_key" ON "push_attempts"("claimKey");
CREATE INDEX IF NOT EXISTS "push_attempts_pushId_idx" ON "push_attempts"("pushId");
