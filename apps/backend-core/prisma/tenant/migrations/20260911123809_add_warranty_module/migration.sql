-- CreateEnum
CREATE TYPE "WarrantyCodeStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "WarrantyServiceStatus" AS ENUM ('NEW', 'REVIEWING', 'AWAITING_PRODUCT', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- AlterTable
ALTER TABLE "warehouse_products" ADD COLUMN     "warrantyDurationDays" INTEGER,
ADD COLUMN     "warrantyEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "warranty_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT,
    "itemDescription" TEXT,
    "invoiceId" TEXT,
    "invoiceLineId" TEXT,
    "manualInvoiceNumber" TEXT,
    "contactId" TEXT,
    "serialNumber" TEXT,
    "durationDays" INTEGER NOT NULL DEFAULT 365,
    "status" "WarrantyCodeStatus" NOT NULL DEFAULT 'PENDING',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "activatedByName" TEXT,
    "activatedByPhone" TEXT,
    "activatedByEmail" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "productPhoto" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranty_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_service_requests" (
    "id" TEXT NOT NULL,
    "warrantyId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photo" TEXT,
    "status" "WarrantyServiceStatus" NOT NULL DEFAULT 'NEW',
    "staffNotes" TEXT,
    "customerRating" INTEGER,
    "customerFeedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "warranty_service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_activation_logs" (
    "id" TEXT NOT NULL,
    "warrantyId" TEXT,
    "codeTried" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "action" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranty_activation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warranty_codes_code_key" ON "warranty_codes"("code");

-- CreateIndex
CREATE INDEX "warranty_codes_status_idx" ON "warranty_codes"("status");

-- CreateIndex
CREATE INDEX "warranty_codes_contactId_idx" ON "warranty_codes"("contactId");

-- CreateIndex
CREATE INDEX "warranty_codes_invoiceId_idx" ON "warranty_codes"("invoiceId");

-- CreateIndex
CREATE INDEX "warranty_codes_invoiceLineId_idx" ON "warranty_codes"("invoiceLineId");

-- CreateIndex
CREATE INDEX "warranty_service_requests_warrantyId_idx" ON "warranty_service_requests"("warrantyId");

-- CreateIndex
CREATE INDEX "warranty_service_requests_status_idx" ON "warranty_service_requests"("status");

-- CreateIndex
CREATE INDEX "warranty_activation_logs_ipAddress_idx" ON "warranty_activation_logs"("ipAddress");

-- CreateIndex
CREATE INDEX "warranty_activation_logs_warrantyId_idx" ON "warranty_activation_logs"("warrantyId");

-- AddForeignKey
ALTER TABLE "warranty_codes" ADD CONSTRAINT "warranty_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "warehouse_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_codes" ADD CONSTRAINT "warranty_codes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_codes" ADD CONSTRAINT "warranty_codes_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "sales_invoice_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_codes" ADD CONSTRAINT "warranty_codes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_codes" ADD CONSTRAINT "warranty_codes_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_service_requests" ADD CONSTRAINT "warranty_service_requests_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "warranty_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_activation_logs" ADD CONSTRAINT "warranty_activation_logs_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "warranty_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
