-- AlterEnum
ALTER TYPE "SalesPaymentMethod" ADD VALUE 'ONLINE_GATEWAY';

-- AlterTable
ALTER TABLE "event_bookings" ADD COLUMN "orderGroupId" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "event_bookings" ALTER COLUMN "orderGroupId" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "event_bookings_orderGroupId_idx" ON "event_bookings"("orderGroupId");

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN "publicToken" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
ADD COLUMN "zarinpalAuthority" TEXT,
ADD COLUMN "paymentRefId" INTEGER;
ALTER TABLE "sales_invoices" ALTER COLUMN "publicToken" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_publicToken_key" ON "sales_invoices"("publicToken");
