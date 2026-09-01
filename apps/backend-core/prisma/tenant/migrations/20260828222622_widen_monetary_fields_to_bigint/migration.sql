-- AlterTable
ALTER TABLE "accounting_journal_lines" ALTER COLUMN "debit" SET DATA TYPE BIGINT,
ALTER COLUMN "credit" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "crm_deals" ALTER COLUMN "value" SET DATA TYPE BIGINT;
