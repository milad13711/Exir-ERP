-- ماژول نمایندگی: تغییر شبا از پنل نماینده پس از تأیید پیامکی، منتظر تأیید مدیر می‌ماند. فقط افزایشی.
ALTER TABLE "agent_profile_changes" ADD COLUMN IF NOT EXISTS "requestedByType" TEXT NOT NULL DEFAULT 'AGENT';
ALTER TABLE "agent_profile_changes" ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT;
ALTER TABLE "agent_profile_changes" ADD COLUMN IF NOT EXISTS "reviewedByUserId" TEXT;
ALTER TABLE "agent_profile_changes" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "agent_profile_changes" ADD COLUMN IF NOT EXISTS "rejectReason" TEXT;
CREATE INDEX IF NOT EXISTS "agent_profile_changes_kind_approvalStatus_idx" ON "agent_profile_changes"("kind", "approvalStatus");
