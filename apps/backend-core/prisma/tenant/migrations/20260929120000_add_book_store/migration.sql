-- CreateEnum
CREATE TYPE "BookOrderFormat" AS ENUM ('PRINT', 'EBOOK', 'AUDIO');

-- CreateEnum
CREATE TYPE "BookOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED', 'SHIPPED', 'DELIVERED');

-- CreateTable
CREATE TABLE "book_orders" (
    "id" TEXT NOT NULL,
    "orderNo" SERIAL NOT NULL,
    "format" "BookOrderFormat" NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerPhone" TEXT NOT NULL,
    "address" TEXT,
    "postalCode" TEXT,
    "unitPrice" INTEGER NOT NULL,
    "status" "BookOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "contactId" TEXT,
    "zarinpalAuthority" TEXT,
    "paymentRefId" INTEGER,
    "paidAt" TIMESTAMP(3),
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "book_orders_orderNo_key" ON "book_orders"("orderNo");

-- CreateIndex
CREATE INDEX "book_orders_status_idx" ON "book_orders"("status");

-- AddForeignKey
ALTER TABLE "book_orders" ADD CONSTRAINT "book_orders_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_orders" ADD CONSTRAINT "book_orders_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
