-- فاکتورهای خودکارِ تننت‌ها ابتدا AWAITING_APPROVAL (کارتابل تأیید تننت مادر) و پس از تأیید PENDING می‌شوند.
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'AWAITING_APPROVAL';

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "issueSource" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "approvalNote" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "approvalHash" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "lastEditedById" TEXT;
