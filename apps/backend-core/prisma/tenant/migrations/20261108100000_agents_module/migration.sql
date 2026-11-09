-- ماژول نمایندگی (agents) — فاز ۱ و ۲: افزایشی؛ هیچ ستون/جدول قدیمی تغییر نمی‌کند.
-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "isAgentRole" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reseller_profiles" ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "shebaVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "agent_products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "referralCodePolicy" TEXT NOT NULL DEFAULT 'MANUAL',
    "holdDays" INTEGER NOT NULL DEFAULT 7,
    "minSettlementAmount" INTEGER NOT NULL DEFAULT 500000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memberships" (
    "id" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'B',
    "referralCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "agreementVersion" INTEGER,
    "agreementAcceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "note" TEXT,
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_commission_rules" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "firstPaymentPercent" DOUBLE PRECISION NOT NULL,
    "renewalPercent" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_agreements" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_agreement_acceptances" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptedByName" TEXT,
    "evidenceId" TEXT,
    "contentHash" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_agreement_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_product_api_keys" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "signingSecretEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "maxPerMinute" INTEGER NOT NULL DEFAULT 120,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_product_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_api_event_logs" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "keyId" TEXT,
    "clientEventId" TEXT,
    "eventId" TEXT,
    "type" TEXT,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "errorCode" TEXT,
    "message" TEXT,
    "payload" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_api_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_customers" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "planCode" TEXT,
    "planName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "funnelStage" TEXT NOT NULL DEFAULT 'REGISTERED',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPaymentAt" TIMESTAMP(3),
    "nextRenewalAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_customer_stage_logs" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "byUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_customer_stage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_payment_events" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentRef" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "originalCurrency" TEXT,
    "originalAmount" INTEGER,
    "planCode" TEXT,
    "planName" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "inboundEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_renewal_reminders" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_renewal_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_profile_changes" (
    "id" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "codeSalt" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_profile_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_audit_logs" (
    "id" TEXT NOT NULL,
    "resellerProfileId" TEXT,
    "membershipId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "actorUserId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_products_code_key" ON "agent_products"("code");

-- CreateIndex
CREATE INDEX "agent_memberships_productId_status_idx" ON "agent_memberships"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_memberships_resellerProfileId_productId_key" ON "agent_memberships"("resellerProfileId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_memberships_productId_referralCode_key" ON "agent_memberships"("productId", "referralCode");

-- CreateIndex
CREATE INDEX "agent_commission_rules_productId_level_effectiveFrom_idx" ON "agent_commission_rules"("productId", "level", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "agent_agreements_productId_version_key" ON "agent_agreements"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "agent_agreement_acceptances_membershipId_agreementId_key" ON "agent_agreement_acceptances"("membershipId", "agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_product_api_keys_keyHash_key" ON "agent_product_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "agent_product_api_keys_productId_status_idx" ON "agent_product_api_keys"("productId", "status");

-- CreateIndex
CREATE INDEX "agent_api_event_logs_productId_createdAt_idx" ON "agent_api_event_logs"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_api_event_logs_status_createdAt_idx" ON "agent_api_event_logs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_api_event_logs_productId_eventId_key" ON "agent_api_event_logs"("productId", "eventId");

-- CreateIndex
CREATE INDEX "agent_customers_membershipId_funnelStage_idx" ON "agent_customers"("membershipId", "funnelStage");

-- CreateIndex
CREATE INDEX "agent_customers_nextRenewalAt_idx" ON "agent_customers"("nextRenewalAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_customers_productId_externalCustomerId_key" ON "agent_customers"("productId", "externalCustomerId");

-- CreateIndex
CREATE INDEX "agent_customer_stage_logs_customerId_createdAt_idx" ON "agent_customer_stage_logs"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_payment_events_membershipId_paidAt_idx" ON "agent_payment_events"("membershipId", "paidAt");

-- CreateIndex
CREATE INDEX "agent_payment_events_customerId_idx" ON "agent_payment_events"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_payment_events_productId_type_paymentRef_key" ON "agent_payment_events"("productId", "type", "paymentRef");

-- CreateIndex
CREATE UNIQUE INDEX "agent_renewal_reminders_customerId_kind_periodEnd_key" ON "agent_renewal_reminders"("customerId", "kind", "periodEnd");

-- CreateIndex
CREATE INDEX "agent_profile_changes_resellerProfileId_kind_createdAt_idx" ON "agent_profile_changes"("resellerProfileId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "agent_audit_logs_resellerProfileId_createdAt_idx" ON "agent_audit_logs"("resellerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_audit_logs_membershipId_createdAt_idx" ON "agent_audit_logs"("membershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_memberships" ADD CONSTRAINT "agent_memberships_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "reseller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memberships" ADD CONSTRAINT "agent_memberships_productId_fkey" FOREIGN KEY ("productId") REFERENCES "agent_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_commission_rules" ADD CONSTRAINT "agent_commission_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "agent_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_agreements" ADD CONSTRAINT "agent_agreements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "agent_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_agreement_acceptances" ADD CONSTRAINT "agent_agreement_acceptances_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "agent_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_agreement_acceptances" ADD CONSTRAINT "agent_agreement_acceptances_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agent_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_product_api_keys" ADD CONSTRAINT "agent_product_api_keys_productId_fkey" FOREIGN KEY ("productId") REFERENCES "agent_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_customers" ADD CONSTRAINT "agent_customers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "agent_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_customers" ADD CONSTRAINT "agent_customers_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "agent_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_customer_stage_logs" ADD CONSTRAINT "agent_customer_stage_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "agent_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payment_events" ADD CONSTRAINT "agent_payment_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "agent_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_renewal_reminders" ADD CONSTRAINT "agent_renewal_reminders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "agent_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_profile_changes" ADD CONSTRAINT "agent_profile_changes_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "reseller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Backfill امن و idempotent: ResellerProfile.productCode → محصول + عضویت (ستون قدیمی حذف/تغییر نمی‌کند) ──
-- منطق معادل: src/agents/agent-backfill.ts (تست واحد دارد).
INSERT INTO "agent_products" ("id", "code", "name", "minSettlementAmount", "updatedAt")
SELECT gen_random_uuid()::text, v.code, v.name,
  COALESCE(
    (SELECT GREATEST(1, ROUND(500000 * (s."value"->>'tomanPerUnitDen')::numeric / NULLIF((s."value"->>'tomanPerUnitNum')::numeric, 0))::int)
       FROM "module_settings" s WHERE s."moduleCode" = 'currency-exchange' AND s."key" = 'baseCurrency' LIMIT 1),
    500000),
  CURRENT_TIMESTAMP
FROM (VALUES
  ('ERP', 'اکسیر ERP'),
  ('REAL_ESTATE', 'اکسیر املاک'),
  ('SMS_GATEWAY', 'پنل پیامک اکسیر'),
  ('OTHER', 'سایر محصولات')
) AS v(code, name)
WHERE EXISTS (SELECT 1 FROM "reseller_profiles" r WHERE r."productCode" IS NOT NULL AND r."productCode"::text = v.code)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "agent_memberships" ("id", "resellerProfileId", "productId", "level", "status", "startedAt", "endedAt", "endReason", "updatedAt")
SELECT gen_random_uuid()::text, r."id", p."id",
  CASE r."tier"::text WHEN 'A_PLUS' THEN 'A_PLUS' WHEN 'A' THEN 'A' ELSE 'B' END,
  CASE r."cooperationStatus"::text WHEN 'ENDED' THEN 'ENDED' ELSE 'ACTIVE' END,
  r."createdAt", r."endedAt", r."endReason", CURRENT_TIMESTAMP
FROM "reseller_profiles" r
JOIN "agent_products" p ON p."code" = r."productCode"::text
WHERE r."productCode" IS NOT NULL
ON CONFLICT ("resellerProfileId", "productId") DO NOTHING;
