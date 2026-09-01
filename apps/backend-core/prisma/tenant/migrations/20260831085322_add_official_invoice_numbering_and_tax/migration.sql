-- AlterTable
ALTER TABLE "crm_contacts" ADD COLUMN     "address" TEXT,
ADD COLUMN     "economicCode" TEXT,
ADD COLUMN     "legalId" TEXT,
ADD COLUMN     "nationalId" TEXT,
ADD COLUMN     "registrationNumber" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "officialInvoiceNo" INTEGER,
ADD COLUMN     "taxAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_officialInvoiceNo_key" ON "sales_invoices"("officialInvoiceNo");


-- Independent sequence for official-invoice numbering, kept separate from
-- the sales_invoices_invoiceNo_seq autoincrement so official invoices get
-- their own back-to-back run (1, 2, 3...) regardless of how many regular
-- invoices are interleaved between them.
CREATE SEQUENCE IF NOT EXISTS "official_invoice_no_seq" START 1;
