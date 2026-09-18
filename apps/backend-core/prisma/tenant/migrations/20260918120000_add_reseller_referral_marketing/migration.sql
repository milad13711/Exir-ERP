-- ماژول رفرال/نمایندگی: نماینده = CrmContact + ResellerProfile ماهواره‌ای.
-- مشتری معرفی‌شده = ReferralConversion، وصل به یک CrmContact در همین
-- تننت — برای استفاده‌ی عمومی هر تننت (کمیسیون از فاکتور فروش خودش) و هم
-- برای تننت رجیستری پلتفرم (controlTenantId، وقتی مشتری = یک تننت جدید
-- exirerp است). کمیسیون = لینک گزارشی روی یک PurchaseOrder واقعی.

CREATE TYPE "ResellerTier" AS ENUM ('A_PLUS', 'A', 'B');
CREATE TYPE "ReferralCommissionKind" AS ENUM ('FIRST_PAYMENT', 'RENEWAL');

CREATE TABLE "reseller_profiles" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "shabaNumber" TEXT,
    "tier" "ResellerTier" NOT NULL DEFAULT 'B',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "commissionFirstPaymentPercent" INTEGER NOT NULL DEFAULT 10,
    "commissionRenewalPercent" INTEGER NOT NULL DEFAULT 5,
    "referralCode" TEXT NOT NULL,
    "npsAvgScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reseller_profiles_contactId_key" ON "reseller_profiles"("contactId");
CREATE UNIQUE INDEX "reseller_profiles_userId_key" ON "reseller_profiles"("userId");
CREATE UNIQUE INDEX "reseller_profiles_referralCode_key" ON "reseller_profiles"("referralCode");

CREATE TABLE "referral_conversions" (
    "id" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "controlTenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_conversions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referral_conversions_contactId_key" ON "referral_conversions"("contactId");
CREATE UNIQUE INDEX "referral_conversions_controlTenantId_key" ON "referral_conversions"("controlTenantId");
CREATE INDEX "referral_conversions_resellerProfileId_idx" ON "referral_conversions"("resellerProfileId");

CREATE TABLE "referral_commissions" (
    "id" TEXT NOT NULL,
    "referralConversionId" TEXT NOT NULL,
    "kind" "ReferralCommissionKind" NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_commissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referral_commissions_purchaseOrderId_key" ON "referral_commissions"("purchaseOrderId");
CREATE INDEX "referral_commissions_referralConversionId_idx" ON "referral_commissions"("referralConversionId");

ALTER TABLE "reseller_profiles" ADD CONSTRAINT "reseller_profiles_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reseller_profiles" ADD CONSTRAINT "reseller_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "reseller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_referralConversionId_fkey" FOREIGN KEY ("referralConversionId") REFERENCES "referral_conversions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
