ALTER TYPE "InvoicePurpose" ADD VALUE IF NOT EXISTS 'SMS_PACKAGE';

CREATE TABLE "sms_packages" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "credits" INTEGER NOT NULL,
  "priceToman" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_packages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sms_packages_code_key" ON "sms_packages"("code");

CREATE TABLE "tenant_sms_wallets" (
  "tenantId" TEXT NOT NULL,
  "credits" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_sms_wallets_pkey" PRIMARY KEY ("tenantId")
);
ALTER TABLE "tenant_sms_wallets" ADD CONSTRAINT "tenant_sms_wallets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- سه بسته‌ی پیش‌فرض؛ قیمت‌ها را مدیر پلتفرم در پنل ادمین تعیین و فعال می‌کند.
INSERT INTO "sms_packages" ("id","code","credits","priceToman","isActive","sortOrder") VALUES
  (gen_random_uuid()::text, 'SMS_500', 500, 0, false, 1),
  (gen_random_uuid()::text, 'SMS_1000', 1000, 0, false, 2),
  (gen_random_uuid()::text, 'SMS_5000', 5000, 0, false, 3);
