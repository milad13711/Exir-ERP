-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateTable
CREATE TABLE "sales_recurring_invoice_templates" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dealId" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "taxRate" INTEGER,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastGeneratedInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_recurring_invoice_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_recurring_invoice_templates_nextRunAt_idx" ON "sales_recurring_invoice_templates"("nextRunAt");

ALTER TABLE "sales_recurring_invoice_templates" ADD CONSTRAINT "sales_recurring_invoice_templates_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_recurring_invoice_templates" ADD CONSTRAINT "sales_recurring_invoice_templates_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_recurring_invoice_templates" ADD CONSTRAINT "sales_recurring_invoice_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "sales_recurring_invoice_lines" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,

    CONSTRAINT "sales_recurring_invoice_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_recurring_invoice_lines" ADD CONSTRAINT "sales_recurring_invoice_lines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "sales_recurring_invoice_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_recurring_invoice_lines" ADD CONSTRAINT "sales_recurring_invoice_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "warehouse_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
