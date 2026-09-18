-- ماژول رفرال/نمایندگی: نماینده = CrmContact + ResellerProfile ماهواره‌ای،
-- تننت معرفی‌شده = ReferredTenant (بدون FK واقعی به کنترل‌پلین)، کمیسیون =
-- لینک گزارشی روی یک PurchaseOrder واقعی.

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

CREATE TABLE "referred_tenants" (
    "id" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "controlTenantId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referred_tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referred_tenants_controlTenantId_key" ON "referred_tenants"("controlTenantId");
CREATE INDEX "referred_tenants_resellerProfileId_idx" ON "referred_tenants"("resellerProfileId");

CREATE TABLE "referral_commissions" (
    "id" TEXT NOT NULL,
    "referredTenantId" TEXT NOT NULL,
    "kind" "ReferralCommissionKind" NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_commissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referral_commissions_purchaseOrderId_key" ON "referral_commissions"("purchaseOrderId");
CREATE INDEX "referral_commissions_referredTenantId_idx" ON "referral_commissions"("referredTenantId");

ALTER TABLE "reseller_profiles" ADD CONSTRAINT "reseller_profiles_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reseller_profiles" ADD CONSTRAINT "reseller_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "referred_tenants" ADD CONSTRAINT "referred_tenants_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "reseller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_referredTenantId_fkey" FOREIGN KEY ("referredTenantId") REFERENCES "referred_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
