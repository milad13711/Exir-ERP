-- ۱) رویدادهای خرید قیف (ایدمپوتنسی شمارش خرید به‌ازای هر سند منبع)
-- ۲) حساب افتتاحیه ۳۰۲۰ برای تننت‌های قدیمی (فقط اگر نبود؛ حساب موجود هرگز تغییر نمی‌کند)
-- افزودنی و idempotent؛ هیچ عبارت حساس به مالکیت (OWNER TO / GRANT) ندارد.

CREATE TABLE IF NOT EXISTS "crm_purchase_events" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    CONSTRAINT "crm_purchase_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_purchase_events_contactId_sourceType_sourceId_key"
  ON "crm_purchase_events"("contactId", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "crm_purchase_events_contactId_voidedAt_idx"
  ON "crm_purchase_events"("contactId", "voidedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_purchase_events_contactId_fkey') THEN
    ALTER TABLE "crm_purchase_events"
      ADD CONSTRAINT "crm_purchase_events_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- پیش‌پر کردن: فاکتورهای فروش «پرداخت‌شده» که پیش‌تر در شمارنده‌ی خرید آمده‌اند، تا پرداخت/رویداد بعدی دوباره نشمارد.
INSERT INTO "crm_purchase_events" ("id", "contactId", "sourceType", "sourceId", "amount", "occurredAt")
SELECT gen_random_uuid()::text, i."contactId", 'SALES_INVOICE', i."id", i."total", COALESCE(i."confirmedAt", i."issuedAt")
FROM "sales_invoices" i
JOIN "crm_contacts" c ON c."id" = i."contactId"
WHERE i."status" = 'PAID'
ON CONFLICT DO NOTHING;

-- حساب افتتاحیه (موازنه‌ی افتتاحیه) — فقط برای تننتی که چارت حساب دارد و ۳۰۲۰ را ندارد.
INSERT INTO "accounting_accounts" ("id", "code", "name", "type", "isCashAccount", "isSystem")
SELECT gen_random_uuid()::text, '3020', 'موجودی افتتاحیه / حساب افتتاحیه', 'EQUITY'::"AccountType", false, true
WHERE EXISTS (SELECT 1 FROM "accounting_accounts")
  AND NOT EXISTS (SELECT 1 FROM "accounting_accounts" WHERE "code" = '3020');
