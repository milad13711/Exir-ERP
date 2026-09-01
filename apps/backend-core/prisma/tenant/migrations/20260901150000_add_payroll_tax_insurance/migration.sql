-- AlterTable
ALTER TABLE "hr_payroll_slips" ADD COLUMN "insuranceAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "taxAmount" INTEGER NOT NULL DEFAULT 0;
