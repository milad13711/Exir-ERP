-- CreateEnum
CREATE TYPE "SalePriceSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "warehouse_products" ADD COLUMN "profitMarginPercent" DECIMAL(6,2);
ALTER TABLE "warehouse_products" ADD COLUMN "salePriceSource" "SalePriceSource" NOT NULL DEFAULT 'AUTO';
ALTER TABLE "warehouse_products" ADD COLUMN "salePriceUpdatedAt" TIMESTAMP(3);
