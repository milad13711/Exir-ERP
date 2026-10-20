-- گزارش تغییرناپذیر «خروج کاربر / انتقال رکوردها» (افزودنی و idempotent).
-- بدون FK به users (عمدی: حذف/ناشناس‌سازی کاربر نباید سابقه را حذف کند)؛ بدون enum جدید؛
-- هیچ عبارت حساس به مالکیت (OWNER TO / GRANT) ندارد.

CREATE TABLE IF NOT EXISTS "user_offboarding_runs" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromUserName" TEXT NOT NULL,
    "toUserId" TEXT,
    "toUserName" TEXT,
    "performedByUserId" TEXT,
    "performedByName" TEXT,
    "mode" TEXT NOT NULL,
    "reason" TEXT,
    "counts" JSONB NOT NULL,
    "details" JSONB,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_offboarding_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_offboarding_runs_fromUserId_createdAt_idx"
  ON "user_offboarding_runs"("fromUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "user_offboarding_runs_createdAt_idx"
  ON "user_offboarding_runs"("createdAt");
