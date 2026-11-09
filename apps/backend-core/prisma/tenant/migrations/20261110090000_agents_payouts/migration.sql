-- فاز ۴ ماژول نمایندگی: درخواست تسویه + پرداخت دستی با شماره‌ی پیگیری، لینک معرفی کارت ویزیت. فقط افزایشی.

ALTER TABLE "agent_products" ADD COLUMN IF NOT EXISTS "referralUrlTemplate" TEXT;

CREATE TABLE IF NOT EXISTS "agent_payouts" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "shebaNumber" TEXT NOT NULL,
    "requestedByType" TEXT NOT NULL DEFAULT 'AGENT',
    "requestedByUserId" TEXT,
    "agentNote" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "paidByUserId" TEXT,
    "paidAt" TIMESTAMP(3),
    "trackingNumber" TEXT,
    "paymentNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_payouts_number_key" ON "agent_payouts"("number");
CREATE INDEX IF NOT EXISTS "agent_payouts_membershipId_status_idx" ON "agent_payouts"("membershipId", "status");
CREATE INDEX IF NOT EXISTS "agent_payouts_status_createdAt_idx" ON "agent_payouts"("status", "createdAt");
-- حداکثر یک درخواست باز (در جریان) برای هر عضویت — پشتوانه‌ی DB برای قفل سرویس
CREATE UNIQUE INDEX IF NOT EXISTS "agent_payouts_one_open_per_membership" ON "agent_payouts"("membershipId") WHERE "status" IN ('REQUESTED', 'APPROVED');
