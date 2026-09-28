CREATE TABLE "invoice_follow_ups" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "outcome" TEXT,
    "followedUpByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_follow_ups_invoiceId_idx" ON "invoice_follow_ups"("invoiceId");

ALTER TABLE "invoice_follow_ups" ADD CONSTRAINT "invoice_follow_ups_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_follow_ups" ADD CONSTRAINT "invoice_follow_ups_followedUpByUserId_fkey" FOREIGN KEY ("followedUpByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
