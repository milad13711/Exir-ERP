-- مدیریت پروژه: تأیید اختیاری مرحله، لینک عمومی مشتری + کامنت/پاسخ، نمایش انتخابی به مشتری، اتصال پروپوزال/فاکتور — additive

-- ۱) لینک عمومی پروژه (توکن برای ردیف‌های موجود هم ساخته می‌شود؛ پیش‌فرض خاموش)
ALTER TABLE "projects" ADD COLUMN "publicToken" TEXT;
UPDATE "projects" SET "publicToken" = gen_random_uuid()::text WHERE "publicToken" IS NULL;
ALTER TABLE "projects" ALTER COLUMN "publicToken" SET NOT NULL;
CREATE UNIQUE INDEX "projects_publicToken_key" ON "projects"("publicToken");
ALTER TABLE "projects" ADD COLUMN "publicEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "lastCustomerCommentNotifiedAt" TIMESTAMP(3);

-- ۲) مراحل: ردیف‌های قبلی = نیاز به تأیید مدیر (رفتار فعلی)
ALTER TABLE "project_stages" ADD COLUMN "requiresManagerApproval" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "project_stages" ADD COLUMN "description" TEXT;
ALTER TABLE "project_stages" ADD COLUMN "descriptionVisibleToCustomer" BOOLEAN NOT NULL DEFAULT false;

-- ۳) لینک‌های مرحله
CREATE TABLE "project_stage_links" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "visibleToCustomer" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_stage_links_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_stage_links_stageId_idx" ON "project_stage_links"("stageId");
ALTER TABLE "project_stage_links" ADD CONSTRAINT "project_stage_links_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "project_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ۴) یادداشت‌های پروژه/مرحله (کامنت مشتری + پاسخ تیم)
CREATE TABLE "project_notes" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "stageId" TEXT,
  "parentId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'STAFF',
  "authorUserId" TEXT,
  "authorName" TEXT,
  "body" TEXT NOT NULL,
  "visibleToCustomer" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_notes_projectId_createdAt_idx" ON "project_notes"("projectId", "createdAt");
CREATE INDEX "project_notes_stageId_idx" ON "project_notes"("stageId");
CREATE INDEX "project_notes_parentId_idx" ON "project_notes"("parentId");
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "project_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "project_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ۵) پیوست‌ها: نمایش به مشتری (پیش‌فرض خصوصی)
ALTER TABLE "generic_attachments" ADD COLUMN "visibleToCustomer" BOOLEAN NOT NULL DEFAULT false;

-- ۶) پروپوزال/فاکتور ↔ پروژه
ALTER TABLE "proposals" ADD COLUMN "projectId" TEXT;
ALTER TABLE "proposals" ADD COLUMN "projectShowOnPublicLink" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "proposals_projectId_idx" ON "proposals"("projectId");
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_invoices" ADD COLUMN "projectShowOnPublicLink" BOOLEAN NOT NULL DEFAULT false;
