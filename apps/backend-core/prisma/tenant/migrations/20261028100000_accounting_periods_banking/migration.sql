-- حسابداری ماهانه (قفل دوره) + بانک، صندوق، دسته‌چک و تراکنش‌های خزانه.
-- فقط افزایشی؛ بدون مقدار enum جدید (وضعیت‌ها ستون TEXT هستند)؛ بدون دستور وابسته به مالکیت.

CREATE TABLE IF NOT EXISTS "accounting_period_locks" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT true,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedByUserId" TEXT,
    "lockNote" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "unlockedByUserId" TEXT,
    "unlockReason" TEXT,
    CONSTRAINT "accounting_period_locks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_period_locks_periodKey_key" ON "accounting_period_locks"("periodKey");

CREATE TABLE IF NOT EXISTS "accounting_bank_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "branch" TEXT,
    "accountNumber" TEXT,
    "sheba" TEXT,
    "cardNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IRT',
    "openingBalance" BIGINT NOT NULL DEFAULT 0,
    "openingDate" TIMESTAMP(3) NOT NULL,
    "openingEntryId" TEXT,
    "linkedAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_bank_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "accounting_bank_accounts_linkedAccountId_idx" ON "accounting_bank_accounts"("linkedAccountId");

CREATE TABLE IF NOT EXISTS "accounting_cash_boxes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "custodianUserId" TEXT,
    "openingBalance" BIGINT NOT NULL DEFAULT 0,
    "openingDate" TIMESTAMP(3) NOT NULL,
    "openingEntryId" TEXT,
    "linkedAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_cash_boxes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "accounting_cash_boxes_linkedAccountId_idx" ON "accounting_cash_boxes"("linkedAccountId");

CREATE TABLE IF NOT EXISTS "accounting_cheque_books" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "series" TEXT,
    "startSerial" INTEGER NOT NULL,
    "endSerial" INTEGER NOT NULL,
    "leafCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_cheque_books_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "accounting_cheque_books_bankAccountId_idx" ON "accounting_cheque_books"("bankAccountId");

CREATE TABLE IF NOT EXISTS "accounting_cheque_leaves" (
    "id" TEXT NOT NULL,
    "chequeBookId" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNUSED',
    "linkedCheckId" TEXT,
    "statusNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_cheque_leaves_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_cheque_leaves_linkedCheckId_key" ON "accounting_cheque_leaves"("linkedCheckId");
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_cheque_leaves_chequeBookId_serial_key" ON "accounting_cheque_leaves"("chequeBookId", "serial");
CREATE INDEX IF NOT EXISTS "accounting_cheque_leaves_status_idx" ON "accounting_cheque_leaves"("status");

CREATE TABLE IF NOT EXISTS "accounting_bank_transactions" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "description" TEXT,
    "referenceNo" TEXT,
    "bankAccountId" TEXT,
    "cashBoxId" TEXT,
    "toBankAccountId" TEXT,
    "toCashBoxId" TEXT,
    "counterAccountId" TEXT,
    "contactId" TEXT,
    "chequeLeafId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "journalEntryId" TEXT,
    "reversalEntryId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_bank_transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_bank_transactions_number_key" ON "accounting_bank_transactions"("number");
CREATE INDEX IF NOT EXISTS "accounting_bank_transactions_date_idx" ON "accounting_bank_transactions"("date");
CREATE INDEX IF NOT EXISTS "accounting_bank_transactions_bankAccountId_idx" ON "accounting_bank_transactions"("bankAccountId");
CREATE INDEX IF NOT EXISTS "accounting_bank_transactions_cashBoxId_idx" ON "accounting_bank_transactions"("cashBoxId");
CREATE INDEX IF NOT EXISTS "accounting_bank_transactions_journalEntryId_idx" ON "accounting_bank_transactions"("journalEntryId");

DO $$ BEGIN
  ALTER TABLE "accounting_bank_accounts" ADD CONSTRAINT "accounting_bank_accounts_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accounting_cash_boxes" ADD CONSTRAINT "accounting_cash_boxes_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accounting_cheque_books" ADD CONSTRAINT "accounting_cheque_books_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "accounting_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accounting_cheque_leaves" ADD CONSTRAINT "accounting_cheque_leaves_chequeBookId_fkey" FOREIGN KEY ("chequeBookId") REFERENCES "accounting_cheque_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accounting_cheque_leaves" ADD CONSTRAINT "accounting_cheque_leaves_linkedCheckId_fkey" FOREIGN KEY ("linkedCheckId") REFERENCES "checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accounting_bank_transactions" ADD CONSTRAINT "accounting_bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "accounting_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accounting_bank_transactions" ADD CONSTRAINT "accounting_bank_transactions_cashBoxId_fkey" FOREIGN KEY ("cashBoxId") REFERENCES "accounting_cash_boxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accounting_bank_transactions" ADD CONSTRAINT "accounting_bank_transactions_toBankAccountId_fkey" FOREIGN KEY ("toBankAccountId") REFERENCES "accounting_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accounting_bank_transactions" ADD CONSTRAINT "accounting_bank_transactions_toCashBoxId_fkey" FOREIGN KEY ("toCashBoxId") REFERENCES "accounting_cash_boxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
