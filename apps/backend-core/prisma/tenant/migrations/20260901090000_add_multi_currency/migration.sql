-- CreateTable: نرخ تبدیل ارزها به تومان — تومان خودش ردیف ندارد (ارز پایه‌ی ضمنی).
CREATE TABLE "currencies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "rate" DECIMAL(18,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");

-- AlterTable: قیمت‌گذاری ارزی محصول (nullable — کالای تومانی بدون تغییر می‌ماند)
ALTER TABLE "warehouse_products" ADD COLUMN "currencyId" TEXT,
ADD COLUMN "costPriceFx" DECIMAL(18,4),
ADD COLUMN "salePriceFx" DECIMAL(18,4);

ALTER TABLE "warehouse_products" ADD CONSTRAINT "warehouse_products_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: قفل نرخ تبدیل در لحظه‌ی ثبت هر قلم فاکتور/پیش‌فاکتور/سفارش خرید
ALTER TABLE "sales_invoice_lines" ADD COLUMN "currencyId" TEXT,
ADD COLUMN "unitPriceFx" DECIMAL(18,4),
ADD COLUMN "exchangeRateFx" DECIMAL(18,4);

ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_quotation_lines" ADD COLUMN "currencyId" TEXT,
ADD COLUMN "unitPriceFx" DECIMAL(18,4),
ADD COLUMN "exchangeRateFx" DECIMAL(18,4);

ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_order_lines" ADD COLUMN "currencyId" TEXT,
ADD COLUMN "unitCostFx" DECIMAL(18,4),
ADD COLUMN "exchangeRateFx" DECIMAL(18,4);

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
