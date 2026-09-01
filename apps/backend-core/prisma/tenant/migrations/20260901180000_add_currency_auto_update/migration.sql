-- AlterTable
ALTER TABLE "currencies" ADD COLUMN "autoUpdate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastAutoRateAt" TIMESTAMP(3);
