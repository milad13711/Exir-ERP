-- CreateEnum
CREATE TYPE "CrmFunnelStage" AS ENUM ('NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'CUSTOMER', 'REPEAT_CUSTOMER', 'BRAND_AMBASSADOR', 'CHURN_RISK', 'CHURNED');

-- CreateEnum
CREATE TYPE "MarketingChannel" AS ENUM ('SMS', 'BALE', 'WHATSAPP', 'INSTAGRAM_TEMPLATE');

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketingRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "crm_contacts" ADD COLUMN     "funnelStage" "CrmFunnelStage" NOT NULL DEFAULT 'NEW_LEAD',
ADD COLUMN     "source" TEXT,
ADD COLUMN     "acquisitionCost" INTEGER,
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "isBrandAmbassador" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "becameAmbassadorAt" TIMESTAMP(3),
ADD COLUMN     "firstPurchaseAt" TIMESTAMP(3),
ADD COLUMN     "lastPurchaseAt" TIMESTAMP(3),
ADD COLUMN     "purchaseCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "avgPurchaseGapDays" INTEGER,
ADD COLUMN     "churnWarningAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "crm_funnel_stage_events" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "fromStage" "CrmFunnelStage",
    "toStage" "CrmFunnelStage" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_funnel_stage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "MarketingChannel" NOT NULL,
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "messageText" TEXT,
    "templateCode" TEXT,
    "templateTitle" TEXT,
    "templateCta" TEXT,
    "audienceFilter" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "attributedOrderCount" INTEGER NOT NULL DEFAULT 0,
    "attributedRevenue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "phone" TEXT,
    "status" "MarketingRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "marketing_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_contacts_funnelStage_idx" ON "crm_contacts"("funnelStage");

-- CreateIndex
CREATE INDEX "crm_contacts_isBrandAmbassador_idx" ON "crm_contacts"("isBrandAmbassador");

-- CreateIndex
CREATE INDEX "crm_funnel_stage_events_contactId_idx" ON "crm_funnel_stage_events"("contactId");

-- CreateIndex
CREATE INDEX "crm_funnel_stage_events_toStage_occurredAt_idx" ON "crm_funnel_stage_events"("toStage", "occurredAt");

-- CreateIndex
CREATE INDEX "marketing_campaigns_status_idx" ON "marketing_campaigns"("status");

-- CreateIndex
CREATE INDEX "marketing_campaigns_createdAt_idx" ON "marketing_campaigns"("createdAt");

-- CreateIndex
CREATE INDEX "marketing_campaign_recipients_campaignId_status_idx" ON "marketing_campaign_recipients"("campaignId", "status");

-- CreateIndex
CREATE INDEX "marketing_campaign_recipients_contactId_idx" ON "marketing_campaign_recipients"("contactId");

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_funnel_stage_events" ADD CONSTRAINT "crm_funnel_stage_events_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "marketing_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "marketing_campaign_recipients_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
