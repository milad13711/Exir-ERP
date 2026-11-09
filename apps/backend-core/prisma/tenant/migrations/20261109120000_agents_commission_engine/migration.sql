-- فاز ۳ ماژول نمایندگی: قوانین پورسانت چندبعدی، دفتر مرکزی تراکنش‌های محصولات، پورسانت/کیف پول، انتقال مشتری.
-- فقط افزایشی. وضعیت‌ها TEXT. جدول قدیمی agent_commission_rules دست‌نخورده می‌ماند (فقط کپی به قالب جدید).

CREATE TABLE IF NOT EXISTS "agent_commission_plan_rules" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "txTypeCode" TEXT,
    "itemCode" TEXT,
    "occurrence" TEXT NOT NULL DEFAULT 'ANY',
    "percent" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "replacesRuleId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_commission_plan_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "agent_commission_plan_rules_productId_level_effectiveFrom_idx" ON "agent_commission_plan_rules"("productId", "level", "effectiveFrom");
DO $$ BEGIN
  ALTER TABLE "agent_commission_plan_rules" ADD CONSTRAINT "agent_commission_plan_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "agent_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "agent_transaction_types" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_transaction_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_transaction_types_productId_code_key" ON "agent_transaction_types"("productId", "code");

CREATE TABLE IF NOT EXISTS "agent_transaction_items" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_transaction_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_transaction_items_productId_code_key" ON "agent_transaction_items"("productId", "code");

CREATE TABLE IF NOT EXISTS "agent_transactions" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalTxId" TEXT NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "customerId" TEXT,
    "membershipId" TEXT,
    "membershipLevel" TEXT,
    "txTypeCode" TEXT NOT NULL,
    "itemCode" TEXT,
    "itemName" TEXT,
    "occurrence" TEXT NOT NULL,
    "grossAmount" INTEGER,
    "discountAmount" INTEGER,
    "taxAmount" INTEGER,
    "netAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "originalCurrency" TEXT NOT NULL,
    "originalNetAmount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "refundOfTransactionId" TEXT,
    "commissionStatus" TEXT NOT NULL,
    "commissionNote" TEXT,
    "inboundEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_transactions_productId_externalTxId_key" ON "agent_transactions"("productId", "externalTxId");
CREATE INDEX IF NOT EXISTS "agent_transactions_productId_paidAt_idx" ON "agent_transactions"("productId", "paidAt");
CREATE INDEX IF NOT EXISTS "agent_transactions_customerId_itemCode_idx" ON "agent_transactions"("customerId", "itemCode");
CREATE INDEX IF NOT EXISTS "agent_transactions_membershipId_paidAt_idx" ON "agent_transactions"("membershipId", "paidAt");

CREATE TABLE IF NOT EXISTS "agent_commissions" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "ruleId" TEXT,
    "level" TEXT NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "baseAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reversesCommissionId" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_commissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_commissions_transactionId_membershipId_kind_key" ON "agent_commissions"("transactionId", "membershipId", "kind");
CREATE INDEX IF NOT EXISTS "agent_commissions_membershipId_availableAt_idx" ON "agent_commissions"("membershipId", "availableAt");
CREATE INDEX IF NOT EXISTS "agent_commissions_productId_createdAt_idx" ON "agent_commissions"("productId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "agent_commissions" ADD CONSTRAINT "agent_commissions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "agent_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "agent_customer_transfers" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromMembershipId" TEXT NOT NULL,
    "toMembershipId" TEXT NOT NULL,
    "reason" TEXT,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_customer_transfers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "agent_customer_transfers_customerId_createdAt_idx" ON "agent_customer_transfers"("customerId", "createdAt");

-- قوانین ساده‌ی قدیمی (پرداخت اول / تمدید برای هر سطح) → دو قانون «هر نوع/هر قلم» در قالب جدید. ایدمپوتنت.
INSERT INTO "agent_commission_plan_rules" ("id", "productId", "level", "occurrence", "percent", "effectiveFrom", "note", "createdByUserId", "createdAt")
SELECT r."id" || ':first', r."productId", r."level", 'FIRST', r."firstPaymentPercent", r."effectiveFrom", r."note", r."createdByUserId", r."createdAt"
FROM "agent_commission_rules" r
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "agent_commission_plan_rules" ("id", "productId", "level", "occurrence", "percent", "effectiveFrom", "note", "createdByUserId", "createdAt")
SELECT r."id" || ':renewal', r."productId", r."level", 'RENEWAL', r."renewalPercent", r."effectiveFrom", r."note", r."createdByUserId", r."createdAt"
FROM "agent_commission_rules" r
ON CONFLICT ("id") DO NOTHING;
