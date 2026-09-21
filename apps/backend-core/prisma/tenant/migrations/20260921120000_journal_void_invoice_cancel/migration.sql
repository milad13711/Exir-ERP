ALTER TABLE "accounting_journal_entries"
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "reversalOfId" TEXT;
CREATE UNIQUE INDEX "accounting_journal_entries_reversalOfId_key" ON "accounting_journal_entries"("reversalOfId");
ALTER TABLE "accounting_journal_entries" ADD CONSTRAINT "accounting_journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "accounting_journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_invoices"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT;
