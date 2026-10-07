-- بایگانی فایل‌های چک‌لیست در گزارش روزانه + تبدیل پیوست به دانش سازمانی/سند محرمانه — additive
ALTER TABLE "generic_attachments" ADD COLUMN "sourceAttachmentId" TEXT;
ALTER TABLE "generic_attachments" ADD COLUMN "sourceNote" TEXT;
CREATE UNIQUE INDEX "generic_attachments_entityType_entityId_sourceAttachmentId_key" ON "generic_attachments"("entityType", "entityId", "sourceAttachmentId");

CREATE TABLE "attachment_conversions" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "convertedByUserId" TEXT,
    "convertedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachment_conversions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attachment_conversions_attachmentId_idx" ON "attachment_conversions"("attachmentId");

ALTER TABLE "confidential_documents" ADD COLUMN "ownerOnly" BOOLEAN NOT NULL DEFAULT false;
