-- AlterTable
ALTER TABLE "book_orders" ADD COLUMN "licenseCode" TEXT,
ADD COLUMN "ebookIssuedAt" TIMESTAMP(3),
ADD COLUMN "ebookError" TEXT;

-- CreateIndex
CREATE INDEX "book_orders_buyerPhone_idx" ON "book_orders"("buyerPhone");
