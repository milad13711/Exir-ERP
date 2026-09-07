-- CreateEnum
CREATE TYPE "StoreReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "warehouse_products" ADD COLUMN     "publicCompareAtPrice" INTEGER;

-- CreateTable
CREATE TABLE "store_reviews" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "StoreReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_reviews_productId_status_idx" ON "store_reviews"("productId", "status");

-- CreateIndex
CREATE INDEX "store_reviews_status_idx" ON "store_reviews"("status");

-- AddForeignKey
ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "warehouse_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

