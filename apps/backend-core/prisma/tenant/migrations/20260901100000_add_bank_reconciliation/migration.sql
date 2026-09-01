-- CreateTable: ردیف صورت‌حساب بانکی برای مغایرت‌گیری دستی با دفتر حسابداری
CREATE TABLE "accounting_bank_statement_lines" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "reference" TEXT,
    "matchedJournalLineId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_bank_statement_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_bank_statement_lines_matchedJournalLineId_key" ON "accounting_bank_statement_lines"("matchedJournalLineId");
CREATE INDEX "accounting_bank_statement_lines_accountId_idx" ON "accounting_bank_statement_lines"("accountId");

ALTER TABLE "accounting_bank_statement_lines" ADD CONSTRAINT "accounting_bank_statement_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_bank_statement_lines" ADD CONSTRAINT "accounting_bank_statement_lines_matchedJournalLineId_fkey" FOREIGN KEY ("matchedJournalLineId") REFERENCES "accounting_journal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounting_bank_statement_lines" ADD CONSTRAINT "accounting_bank_statement_lines_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
