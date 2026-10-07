-- فرم‌ساز: صندوق ورودی (وضعیت/مشاهده/یادداشت)، متای منبع، و مبداهای مجاز جاسازی — additive
CREATE TYPE "FormSubmissionStatus" AS ENUM ('NEW', 'IN_REVIEW', 'DONE');

ALTER TABLE "forms" ADD COLUMN "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "form_submissions"
  ADD COLUMN "status" "FormSubmissionStatus" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "viewedAt" TIMESTAMP(3),
  ADD COLUMN "viewedByUserId" TEXT,
  ADD COLUMN "internalNote" TEXT,
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "sourceMeta" JSONB,
  ADD COLUMN "ipMasked" TEXT;

-- پاسخ‌های قبل از این قابلیت «جدید» حساب نشوند (وگرنه ویجت داشبورد یکباره پر از پاسخ‌های قدیمی می‌شود)
UPDATE "form_submissions" SET "status" = 'IN_REVIEW', "viewedAt" = "submittedAt";

CREATE INDEX "form_submissions_formId_status_idx" ON "form_submissions"("formId", "status");
