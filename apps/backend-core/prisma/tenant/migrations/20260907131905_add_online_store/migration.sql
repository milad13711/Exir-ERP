-- CreateEnum
CREATE TYPE "StoreOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StoreAnalyticsEventType" AS ENUM ('PAGE_VIEW', 'PRODUCT_VIEW', 'PRODUCT_DWELL', 'ADD_TO_CART', 'ORDER_PLACED');

-- AlterTable
ALTER TABLE "warehouse_products" ADD COLUMN     "isPubliclyListed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicDescription" TEXT,
ADD COLUMN     "publicImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "publicSlug" TEXT,
ADD COLUMN     "reservedQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "store_orders" (
    "id" TEXT NOT NULL,
    "orderNo" SERIAL NOT NULL,
    "contactId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "shippingAddress" TEXT NOT NULL,
    "notes" TEXT,
    "status" "StoreOrderStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal" INTEGER NOT NULL,
    "trackingCode" TEXT,
    "sessionToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "store_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,

    CONSTRAINT "store_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_analytics_events" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "type" "StoreAnalyticsEventType" NOT NULL,
    "productId" TEXT,
    "meta" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_orders_orderNo_key" ON "store_orders"("orderNo");

-- CreateIndex
CREATE INDEX "store_orders_status_idx" ON "store_orders"("status");

-- CreateIndex
CREATE INDEX "store_orders_createdAt_idx" ON "store_orders"("createdAt");

-- CreateIndex
CREATE INDEX "store_orders_contactId_idx" ON "store_orders"("contactId");

-- CreateIndex
CREATE INDEX "store_order_lines_orderId_idx" ON "store_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "store_order_lines_productId_idx" ON "store_order_lines"("productId");

-- CreateIndex
CREATE INDEX "store_analytics_events_type_occurredAt_idx" ON "store_analytics_events"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "store_analytics_events_sessionToken_idx" ON "store_analytics_events"("sessionToken");

-- CreateIndex
CREATE INDEX "store_analytics_events_productId_idx" ON "store_analytics_events"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_products_publicSlug_key" ON "warehouse_products"("publicSlug");

-- AddForeignKey
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_lines" ADD CONSTRAINT "store_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

