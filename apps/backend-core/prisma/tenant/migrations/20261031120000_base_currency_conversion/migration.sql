-- تغییر ارز پایه: جدول‌های عملیات، لاگ گرد‌کردن و کد تأیید (همه افزودنی).
-- بدون هیچ دستور وابسته به مالکیت؛ بدون enum؛ وضعیت‌ها TEXT.

CREATE TABLE IF NOT EXISTS "base_currency_conversions" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CONVERT',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fromCode" TEXT NOT NULL,
    "toCode" TEXT NOT NULL,
    "fromLabel" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "rateNum" TEXT NOT NULL,
    "rateDen" TEXT NOT NULL,
    "roundingMode" TEXT NOT NULL DEFAULT 'STRICT',
    "reverseOfId" TEXT,
    "reversedById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "backupFile" TEXT,
    "backupSha256" TEXT,
    "backupSize" TEXT,
    "backupAt" TIMESTAMP(3),
    "executedByUserId" TEXT,
    "executedByName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_currency_conversions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "base_currency_conversions_idempotencyKey_key" ON "base_currency_conversions"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "base_currency_conversions_status_idx" ON "base_currency_conversions"("status");
CREATE INDEX IF NOT EXISTS "base_currency_conversions_createdAt_idx" ON "base_currency_conversions"("createdAt");

-- حداکثر یک عملیات در حال اجرا در هر لحظه (قفل در سطح دیتابیس)
CREATE UNIQUE INDEX IF NOT EXISTS "base_currency_conversions_single_running" ON "base_currency_conversions" ((1)) WHERE "status" = 'RUNNING';

CREATE TABLE IF NOT EXISTS "base_currency_rounding_log" (
    "id" TEXT NOT NULL,
    "conversionId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnName" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ROUND',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_currency_rounding_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "base_currency_rounding_log_conversionId_idx" ON "base_currency_rounding_log"("conversionId");
CREATE INDEX IF NOT EXISTS "base_currency_rounding_log_conversionId_tableName_idx" ON "base_currency_rounding_log"("conversionId", "tableName");

CREATE TABLE IF NOT EXISTS "base_currency_confirmations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_currency_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "base_currency_confirmations_userId_createdAt_idx" ON "base_currency_confirmations"("userId", "createdAt");
