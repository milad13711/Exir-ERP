-- CreateEnum
CREATE TYPE "InvoicePurpose" AS ENUM ('TENANT_SETUP', 'PLAN_RENEWAL', 'MODULE_PURCHASE', 'MODULE_RENEWAL');

-- CreateEnum
CREATE TYPE "ModuleBillingMode" AS ENUM ('MONTHLY', 'YEARLY', 'LICENSE');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "purpose" "InvoicePurpose",
ADD COLUMN     "items" JSONB;

-- AlterTable
ALTER TABLE "module_definitions" ADD COLUMN     "priceYearly" INTEGER,
ADD COLUMN     "demoDescription" TEXT,
ADD COLUMN     "demoValueProps" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "demoScreenshot1Url" TEXT,
ADD COLUMN     "demoScreenshot2Url" TEXT;

-- AlterTable
ALTER TABLE "tenant_modules" ADD COLUMN     "billingMode" "ModuleBillingMode",
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "pendingRenewalInvoiceId" TEXT,
ADD COLUMN     "trialActivatedAt" TIMESTAMP(3),
ADD COLUMN     "trialRecordCreatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_modules_pendingRenewalInvoiceId_key" ON "tenant_modules"("pendingRenewalInvoiceId");
