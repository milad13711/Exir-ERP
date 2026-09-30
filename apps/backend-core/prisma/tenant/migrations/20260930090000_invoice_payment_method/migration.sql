-- CreateEnum
CREATE TYPE "SalesInvoicePaymentMethod" AS ENUM ('BANK_TRANSFER', 'ONLINE_GATEWAY', 'CASH', 'CHECK');

-- AlterTable: روش پرداخت انتخابی صادرکننده روی خود فاکتور (پیش‌فرض CASH — بدون نمایش خودکار لینک پرداخت آنلاین)
ALTER TABLE "sales_invoices" ADD COLUMN "paymentMethod" "SalesInvoicePaymentMethod" NOT NULL DEFAULT 'CASH';
ALTER TABLE "sales_invoices" ADD COLUMN "paymentBankInfo" TEXT;

-- AlterTable: عکس چک دریافتی — همان الگوی base64 data URL بدون object storage
ALTER TABLE "checks" ADD COLUMN "photoDataUrl" TEXT;
