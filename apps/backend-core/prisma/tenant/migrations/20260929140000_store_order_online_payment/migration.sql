-- AlterTable
ALTER TABLE "store_orders" ADD COLUMN "zarinpalAuthority" TEXT,
ADD COLUMN "paymentRefId" INTEGER,
ADD COLUMN "paidAt" TIMESTAMP(3);
