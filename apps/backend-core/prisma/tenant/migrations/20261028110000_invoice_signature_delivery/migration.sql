-- استقلال فاکتور از حسابداری + امضای داخلی فاکتور + تأیید تحویل از لینک عمومی (همه افزودنی).
-- بدون هیچ دستور وابسته به مالکیت؛ بدون مقدار enum تازه.

-- پرچم «سند حسابداری ثبت شده». تا امروز حسابداری پیش‌نیاز فروش بود، پس هر ردیف موجود
-- (پرداخت/مرجوعی/فاکتور تأییدشده) سندش ثبت شده است → ردیف‌های قدیمی true؛ ردیف‌های تازه false.
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "accountingPosted" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sales_invoices" ALTER COLUMN "accountingPosted" SET DEFAULT false;
UPDATE "sales_invoices" SET "accountingPosted" = false WHERE "status" IN ('DRAFT', 'CANCELLED') AND "journalEntryId" IS NULL;

ALTER TABLE "sales_payments" ADD COLUMN IF NOT EXISTS "accountingPosted" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sales_payments" ALTER COLUMN "accountingPosted" SET DEFAULT false;
ALTER TABLE "sales_payments" ADD COLUMN IF NOT EXISTS "journalEntryId" TEXT;

ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "accountingPosted" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sales_returns" ALTER COLUMN "accountingPosted" SET DEFAULT false;

-- امضای داخلی و تحویل
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "signatureKind" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "stampDataUrl" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "signedContentHash" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "signatureInvalidatedAt" TIMESTAMP(3);
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "signatureInvalidReason" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "deliveryMethod" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "deliveryChannel" TEXT;

-- فاکتورهای امضاشده‌ی قبلی همه با امضای دست‌نویس مستقیم بوده‌اند
UPDATE "sales_invoices" SET "signatureKind" = 'DRAWN' WHERE "signedAt" IS NOT NULL AND "signatureKind" IS NULL AND "signatureDataUrl" IS NOT NULL;
UPDATE "sales_invoices" SET "deliveryMethod" = CASE WHEN "deliverySignatureDataUrl" IS NOT NULL THEN 'SIGNATURE' ELSE 'CODE' END, "deliveryChannel" = 'PANEL' WHERE "deliveryConfirmedAt" IS NOT NULL AND "deliveryMethod" IS NULL;

-- کد یکبارمصرف تأیید تحویل از صفحه‌ی عمومی
CREATE TABLE IF NOT EXISTS "invoice_delivery_otps" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "phoneMasked" TEXT,
    "ipHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_delivery_otps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "invoice_delivery_otps_invoiceId_createdAt_idx" ON "invoice_delivery_otps"("invoiceId", "createdAt");
CREATE INDEX IF NOT EXISTS "invoice_delivery_otps_createdAt_idx" ON "invoice_delivery_otps"("createdAt");
DO $$ BEGIN
  ALTER TABLE "invoice_delivery_otps" ADD CONSTRAINT "invoice_delivery_otps_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
