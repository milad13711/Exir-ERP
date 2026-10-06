-- CreateEnum
CREATE TYPE "TaxEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "TaxInvoiceStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'QUEUED', 'SENT', 'ACCEPTED', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaxInvoiceSubject" AS ENUM ('ORIGINAL', 'CORRECTION', 'CANCELLATION', 'RETURN');

-- CreateTable
CREATE TABLE "tax_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "economicCode" TEXT,
    "fiscalId" TEXT,
    "taxpayerName" TEXT,
    "postalCode" TEXT,
    "branchCode" TEXT,
    "environment" "TaxEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "sendingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sandboxBaseUrl" TEXT,
    "defaultVatRate" DOUBLE PRECISION,
    "defaultSstid" TEXT,
    "defaultUnitCode" INTEGER,
    "privateKeyEnc" TEXT,
    "keyFingerprint" TEXT,
    "certificatePem" TEXT,
    "certFingerprint" TEXT,
    "certValidTo" TIMESTAMP(3),
    "signatureKeyId" TEXT,
    "serverPublicKeyId" TEXT,
    "serverPublicKeyPem" TEXT,
    "serverKeyFetchedAt" TIMESTAMP(3),
    "verifiedAgainstSandboxAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_product_codes" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sstid" TEXT NOT NULL,
    "unitCode" INTEGER NOT NULL,
    "vatRate" DOUBLE PRECISION,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_product_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_invoices" (
    "id" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "refTaxInvoiceId" TEXT,
    "status" "TaxInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" "TaxInvoiceSubject" NOT NULL DEFAULT 'ORIGINAL',
    "pattern" INTEGER NOT NULL DEFAULT 1,
    "invoiceType" INTEGER NOT NULL DEFAULT 2,
    "taxid" TEXT,
    "inno" TEXT,
    "irtaxid" TEXT,
    "uid" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "overrides" JSONB,
    "payloadSnapshot" JSONB,
    "normalizedHash" TEXT,
    "mappingVersion" TEXT,
    "errors" JSONB,
    "environment" "TaxEnvironment",
    "requestedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "resultAt" TIMESTAMP(3),
    "lastInquiryAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "retryFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_submission_logs" (
    "id" TEXT NOT NULL,
    "taxInvoiceId" TEXT,
    "kind" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "requestTraceId" TEXT,
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "summary" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_submission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_product_codes_productId_key" ON "tax_product_codes"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_invoices_uid_key" ON "tax_invoices"("uid");

-- CreateIndex
CREATE INDEX "tax_invoices_salesInvoiceId_idx" ON "tax_invoices"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "tax_invoices_status_idx" ON "tax_invoices"("status");

-- CreateIndex
CREATE INDEX "tax_invoices_createdAt_idx" ON "tax_invoices"("createdAt");

-- CreateIndex
CREATE INDEX "tax_submission_logs_taxInvoiceId_createdAt_idx" ON "tax_submission_logs"("taxInvoiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "tax_product_codes" ADD CONSTRAINT "tax_product_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "warehouse_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_refTaxInvoiceId_fkey" FOREIGN KEY ("refTaxInvoiceId") REFERENCES "tax_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_submission_logs" ADD CONSTRAINT "tax_submission_logs_taxInvoiceId_fkey" FOREIGN KEY ("taxInvoiceId") REFERENCES "tax_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

